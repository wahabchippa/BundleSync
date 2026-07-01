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

    const groups = {};
    orders.forEach((order) => {
      const key = order.customer_name
        ? "NAME:" + order.customer_name.trim().toLowerCase()
        : "ID:" + (order.customer_id || "UNKNOWN");

      if (!groups[key]) groups[key] = [];
      groups[key].push(order);
    });

    const results = { created: 0, updated: 0, locked_skipped: 0, errors: [] };

    for (const [customerKey, customerOrders] of Object.entries(groups)) {
      if (customerOrders.length < 2) continue;

      const fleekIds = customerOrders.map((o) => o.fleek_id);

      const { data: existingMarkings } = await supabase
        .from("order_markings")
        .select("fleek_id, bundle_id")
        .in("fleek_id", fleekIds)
        .not("bundle_id", "is", null);

      let existingBundleId = existingMarkings?.[0]?.bundle_id || null;

      if (existingBundleId) {
        const { data: bundleData } = await supabase
          .from("order_bundles")
          .select("is_locked, status")
          .eq("bundle_id", existingBundleId)
          .single();

        if (bundleData?.is_locked || bundleData?.status === "Complete") {
          results.locked_skipped++;
          console.log(`Bundle ${existingBundleId} is locked. Skipping.`);
          continue;
        }

        await supabase
          .from("order_bundles")
          .update({ updated_at: new Date().toISOString() })
          .eq("bundle_id", existingBundleId);

        results.updated++;
      } else {
        const newBundleId = generateBundleId(customerKey);
        const customerName = customerOrders[0].customer_name || customerKey;

        const { error: bundleError } = await supabase
          .from("order_bundles")
          .insert({
            bundle_id: newBundleId,
            customer_name: customerName,
            customer_id: customerOrders[0].customer_id,
            status: "Pending",
            is_locked: false,
          });

        if (bundleError) {
          results.errors.push(`Bundle create error: ${bundleError.message}`);
          continue;
        }

        existingBundleId = newBundleId;
        results.created++;
      }

      for (const order of customerOrders) {
        await supabase
          .from("order_markings")
          .upsert(
            {
              fleek_id: order.fleek_id,
              bundle_id: existingBundleId,
              packing_status: "Hold for bundling",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "fleek_id" }
          );
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
