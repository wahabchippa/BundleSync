import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const BUNDLE_WINDOW_DAYS = 3;

function generateBundleId(customerKey) {
  const timestamp = Date.now();
  const clean = customerKey.replace(/[^a-z0-9]/gi, "").substring(0, 20);
  return `BND-${clean}-${timestamp}`.toUpperCase();
}

function normalizeCustomerId(v) {
  const s = String(v || "").trim();
  if (!s || s.toLowerCase() === "unknown" || s === "-") return null;
  return s;
}

function normalizeName(v) {
  const s = String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s || null;
}

function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function daysDiff(d1, d2) {
  if (!d1 || !d2) return Infinity;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.abs((d1 - d2) / msPerDay);
}

function groupOrdersByTimeWindow(orders, windowDays) {
  if (orders.length < 2) return [orders];

  orders.sort((a, b) => {
    const da = parseDate(a.created_at);
    const db = parseDate(b.created_at);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return da - db;
  });

  const subGroups = [];
  let currentGroup = [orders[0]];

  for (let i = 1; i < orders.length; i++) {
    const prevDate = parseDate(orders[i - 1].created_at);
    const currDate = parseDate(orders[i].created_at);

    if (daysDiff(prevDate, currDate) <= windowDays) {
      currentGroup.push(orders[i]);
    } else {
      subGroups.push(currentGroup);
      currentGroup = [orders[i]];
    }
  }

  subGroups.push(currentGroup);
  return subGroups;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { orders } = req.body;

    if (!orders || !Array.isArray(orders)) {
      return res.status(400).json({ error: "orders array required" });
    }

    const allFleekIds = orders.map((o) => o.fleek_id).filter(Boolean);

    const { data: existingMarkings, error: markingsError } = await supabase
      .from("order_markings")
      .select("fleek_id, bundle_id, packing_status")
      .in("fleek_id", allFleekIds);

    if (markingsError) {
      return res.status(500).json({ error: "Failed to fetch markings: " + markingsError.message });
    }

    const markingsMap = {};
    (existingMarkings || []).forEach((m) => {
      markingsMap[m.fleek_id] = m;
    });

    const lockedBundleIds = new Set();

    const bundleIdsToCheck = [
      ...new Set(
        (existingMarkings || [])
          .map((m) => m.bundle_id)
          .filter(Boolean)
      )
    ];

    if (bundleIdsToCheck.length > 0) {
      const { data: bundlesData, error: bundlesError } = await supabase
        .from("order_bundles")
        .select("bundle_id, is_locked, status")
        .in("bundle_id", bundleIdsToCheck);

      if (bundlesError) {
        return res.status(500).json({ error: "Failed to fetch bundles: " + bundlesError.message });
      }

      (bundlesData || []).forEach((b) => {
        if (b.is_locked || b.status === "Complete") {
          lockedBundleIds.add(b.bundle_id);
        }
      });
    }

    const eligibleOrders = orders.filter((o) => {
      const marking = markingsMap[o.fleek_id];
      if (!marking) return true;
      if (!marking.bundle_id) return true;
      if (lockedBundleIds.has(marking.bundle_id)) return false;
      return true;
    });

    const nameToIds = {};
    eligibleOrders.forEach((order) => {
      const id = normalizeCustomerId(order.customer_id);
      const name = normalizeName(order.customer_name);

      if (id && name) {
        if (!nameToIds[name]) nameToIds[name] = new Set();
        nameToIds[name].add(id);
      }
    });

    const customerGroups = {};
    eligibleOrders.forEach((order) => {
      const id = normalizeCustomerId(order.customer_id);
      const name = normalizeName(order.customer_name);

      let key;

      if (id) {
        key = "ID:" + id;
      } else if (name && nameToIds[name] && nameToIds[name].size === 1) {
        const knownId = [...nameToIds[name]][0];
        key = "ID:" + knownId;
      } else if (name) {
        key = "NAME:" + name;
      } else {
        key = "UNKNOWN:" + order.fleek_id;
      }

      if (!customerGroups[key]) customerGroups[key] = [];
      customerGroups[key].push(order);
    });

    const results = {
      created: 0,
      locked_skipped: 0,
      ignored_singletons: 0,
      time_window_splits: 0,
      errors: []
    };

    for (const [customerKey, customerOrders] of Object.entries(customerGroups)) {
      const timeSubGroups = groupOrdersByTimeWindow(customerOrders, BUNDLE_WINDOW_DAYS);

      if (timeSubGroups.length > 1) {
        results.time_window_splits += timeSubGroups.length - 1;
      }

      for (const subGroup of timeSubGroups) {
        if (subGroup.length < 2) {
          results.ignored_singletons += subGroup.length;

          for (const order of subGroup) {
            if (!markingsMap[order.fleek_id]) {
              await supabase.from("order_markings").upsert(
                {
                  fleek_id: order.fleek_id,
                  packing_status: "Pending",
                  bundle_id: null,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "fleek_id" }
              );
            }
          }

          continue;
        }

        const newBundleId = generateBundleId(customerKey);
        const customerName = subGroup[0].customer_name || customerKey;

        const { error: bundleError } = await supabase.from("order_bundles").insert({
          bundle_id: newBundleId,
          customer_name: customerName,
          customer_id: subGroup[0].customer_id || null,
          status: "Pending",
          is_locked: true,
        });

        if (bundleError) {
          results.errors.push(`Bundle create error for ${customerKey}: ${bundleError.message}`);
          continue;
        }

        results.created++;

        for (const order of subGroup) {
          const existingMarking = markingsMap[order.fleek_id];
          const packingStatus = existingMarking?.packing_status || "Hold for bundling";

          const { error: upsertError } = await supabase.from("order_markings").upsert(
            {
              fleek_id: order.fleek_id,
              bundle_id: newBundleId,
              packing_status: packingStatus,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "fleek_id" }
          );

          if (upsertError) {
            results.errors.push(`Order upsert error for ${order.fleek_id}: ${upsertError.message}`);
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: "Bundle sync complete",
      bundle_window_days: BUNDLE_WINDOW_DAYS,
      results,
    });
  } catch (err) {
    console.error("Bundle engine error:", err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { maxDuration: 60 };
