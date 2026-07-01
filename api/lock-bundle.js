import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { bundle_id, action } = req.body;

    if (!bundle_id) {
      return res.status(400).json({ error: "bundle_id required" });
    }

    const is_locked = action === "lock" ? true : false;
    const status = action === "lock" ? "Complete" : "Pending";

    const { data, error } = await supabase
      .from("order_bundles")
      .update({ is_locked, status, updated_at: new Date().toISOString() })
      .eq("bundle_id", bundle_id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: `Bundle ${action}ed successfully`,
      bundle: data,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { maxDuration: 10 };
