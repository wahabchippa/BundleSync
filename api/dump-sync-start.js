import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const CONFIG = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || "13gjj21TS80z2HdNzWxl5Ciftfutd_4sHyEy_yJjvebM",
    sheetName: process.env.GOOGLE_SHEET_NAME || "RAW DATA",
    markerCell: "A2",
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
};

let sheetsClient = null;

async function getSheets() {
  if (sheetsClient) return sheetsClient;

  const oauth = new google.auth.OAuth2(
    CONFIG.google.clientId,
    CONFIG.google.clientSecret,
    "https://developers.google.com/oauthplayground"
  );

  oauth.setCredentials({ refresh_token: CONFIG.google.refreshToken });
  await oauth.getAccessToken();

  sheetsClient = google.sheets({ version: "v4", auth: oauth });
  return sheetsClient;
}

async function getDumpMarker() {
  const client = await getSheets();
  const resp = await client.spreadsheets.values.get({
    spreadsheetId: CONFIG.google.spreadsheetId,
    range: `'${CONFIG.google.sheetName}'!${CONFIG.google.markerCell}`,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const marker = String(resp.data.values?.[0]?.[0] || "").trim();
  if (!marker) {
    throw new Error("Dump marker not found in A2");
  }

  return marker;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const dumpMarker = await getDumpMarker();

    const { data, error } = await supabase.rpc("try_start_dump_sync", {
      p_sync_key: "daily_dump",
      p_dump_marker: dumpMarker,
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;

    return res.status(200).json({
      success: true,
      action: row?.action || "unknown",
      message: row?.message || "",
      dump_marker: dumpMarker,
      last_dump_marker: row?.last_dump_marker || null,
    });
  } catch (err) {
    console.error("dump-sync-start error:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

export const config = { maxDuration: 30 };
