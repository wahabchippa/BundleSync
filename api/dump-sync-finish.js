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
    const { dump_marker, failed, result } = req.body || {};

    if (failed) {
      const { error } = await supabase.rpc("fail_dump_sync", {
        p_sync_key: "daily_dump",
        p_result: result || {},
      });
      if (error) throw error;

      return res.status(200).json({ success: true, status: "failed_released" });
    }

    const { error } = await supabase.rpc("finish_dump_sync", {
      p_sync_key: "daily_dump",
      p_dump_marker: dump_marker || "",
      p_result: result || {},
    });

    if (error) throw error;

    return res.status(200).json({ success: true, status: "completed" });
  } catch (err) {
    console.error("dump-sync-finish error:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

export const config = { maxDuration: 15 };
