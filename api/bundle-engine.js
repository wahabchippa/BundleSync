import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

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

    const nameToIds = {};
    orders.forEach((order) => {
      const id = normalizeCustomerId(order.customer_id);
      const name = normalizeName(order.customer_name);

      if (id && name) {
        if (!nameToIds[name]) nameToIds[name] = new Set();
        nameToIds[name].add(id);
      }
    });

    const groups = {};
    orders.forEach((order) => {
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

      if (!groups[key]) groups[key] = [];
      groups[key].push(order);
    });

    const results = {
      created: 0,
      updated: 0,
      locked_skipped: 0,
      ignored_singletons: 0,
      errors: []
    };

    for (const [customerKey, customerOrders] of Object.entries(groups)) {
      if (customerOrders.length < 2) {
        results.ignored_singletons++;
        continue;
      }

      const fleekIds = customerOrders.map((o) => o.fleek_id).filter(Boolean);

      const { data: existingMarkings, error: existingMarkingsError } = await supabase
        .from("order_markings")
        .select("fleek_id, bundle_id, packing_status")
        .in("fleek_id", fleekIds);

      if (existingMarkingsError) {
        results.errors.push(`Existing markings fetch error for ${customerKey}: ${existingMarkingsError.message}`);
        continue;
      }

      const existingBundleIds = [
        ...new Set(
          (existingMarkings || [])
            .map((m) => m.bundle_id)
            .filter(Boolean)
        )
      ];

      if (existingBundleIds.length > 1) {
        results.errors.push(`Multiple bundle IDs found for ${customerKey}: ${existingBundleIds.join(", ")}`);
        continue;
      }

      let existingBundleId = existingBundleIds[0] || null;

      if (existingBundleId) {
        const { data: bundleData, error: bundleFetchError } = await supabase
          .from("order_bundles")
          .select("is_locked, status")
          .eq("bundle_id", existingBundleId)
          .single();

        if (bundleFetchError) {
          results.errors.push(`Bundle fetch error for ${existingBundleId}: ${bundleFetchError.message}`);
          continue;
        }

        if (bundleData?.is_locked || bundleData?.status === "Complete") {
          results.locked_skipped++;
          continue;
        }

        const { error: bundleUpdateError } = await supabase
          .from("order_bundles")
          .update({ updated_at: new Date().toISOString() })
          .eq("bundle_id", existingBundleId);

        if (bundleUpdateError) {
          results.errors.push(`Bundle update error for ${existingBundleId}: ${bundleUpdateError.message}`);
          continue;
        }

        results.updated++;
      } else {
        const newBundleId = generateBundleId(customerKey);
        const customerName = customerOrders[0].customer_name || customerKey;

        const { error: bundleError } = await supabase
          .from("order_bundles")
          .insert({
            bundle_id: newBundleId,
            customer_name: customerName,
            customer_id: customerOrders[0].customer_id || null,
            status: "Pending",
            is_locked: false,
          });

        if (bundleError) {
          results.errors.push(`Bundle create error for ${customerKey}: ${bundleError.message}`);
          continue;
        }

        existingBundleId = newBundleId;
        results.created++;
      }

      for (const order of customerOrders) {
        const existingMarking = (existingMarkings || []).find((m) => m.fleek_id === order.fleek_id);
        const packingStatusToSave = existingMarking?.packing_status || "Hold for bundling";

        const { error: upsertError } = await supabase
          .from("order_markings")
          .upsert(
            {
              fleek_id: order.fleek_id,
              bundle_id: existingBundleId,
              packing_status: packingStatusToSave,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "fleek_id" }
          );

        if (upsertError) {
          results.errors.push(`Order upsert error for ${order.fleek_id}: ${upsertError.message}`);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: "Bundle sync complete",
      results,
    });
  } catch (err) {
    console.error("Bundle engine error:", err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { maxDuration: 60 };
