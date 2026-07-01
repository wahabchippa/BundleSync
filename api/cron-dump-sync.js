import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const SYNC_KEY = "daily_dump";
const MAX_ORDERS_PER_CHUNK = 120;
const MAX_RUN_MS = 45000;

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

function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;

  const auth = req.headers.authorization || "";
  const key = req.query?.key || "";

  return auth === `Bearer ${secret}` || key === secret;
}

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
  if (!marker) throw new Error("Dump marker not found in A2");
  return marker;
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

function buildChunks(orders) {
  const nameToIds = {};

  orders.forEach((o) => {
    const id = normalizeCustomerId(o.customer_id);
    const name = normalizeName(o.customer_name);

    if (id && name) {
      if (!nameToIds[name]) nameToIds[name] = new Set();
      nameToIds[name].add(id);
    }
  });

  const groups = {};
  orders.forEach((o) => {
    const id = normalizeCustomerId(o.customer_id);
    const name = normalizeName(o.customer_name);

    let key;
    if (id) {
      key = "ID:" + id;
    } else if (name && nameToIds[name] && nameToIds[name].size === 1) {
      key = "ID:" + Array.from(nameToIds[name])[0];
    } else if (name) {
      key = "NAME:" + name;
    } else {
      key = "UNKNOWN:" + o.fleek_id;
    }

    if (!groups[key]) groups[key] = [];
    groups[key].push(o);
  });

  const groupArrays = Object.values(groups);
  const chunks = [];
  let currentGroups = [];
  let currentCount = 0;

  for (const group of groupArrays) {
    if (currentCount + group.length > MAX_ORDERS_PER_CHUNK && currentGroups.length > 0) {
      chunks.push(currentGroups.flat());
      currentGroups = [group];
      currentCount = group.length;
    } else {
      currentGroups.push(group);
      currentCount += group.length;
    }
  }

  if (currentGroups.length > 0) {
    chunks.push(currentGroups.flat());
  }

  return chunks;
}

function emptyResult() {
  return {
    created: 0,
    locked_skipped: 0,
    ignored_singletons: 0,
    time_window_splits: 0,
    errors: [],
  };
}

function normalizeResult(r) {
  const base = emptyResult();
  if (!r || typeof r !== "object") return base;

  base.created = Number(r.created || 0);
  base.locked_skipped = Number(r.locked_skipped || 0);
  base.ignored_singletons = Number(r.ignored_singletons || 0);
  base.time_window_splits = Number(r.time_window_splits || 0);
  base.errors = Array.isArray(r.errors) ? r.errors : [];
  return base;
}

function mergeResults(total, part) {
  const p = normalizeResult(part);
  total.created += p.created;
  total.locked_skipped += p.locked_skipped;
  total.ignored_singletons += p.ignored_singletons;
  total.time_window_splits += p.time_window_splits;
  total.errors.push(...p.errors);
  return total;
}

async function fetchJson(url) {
  const resp = await fetch(url);
  const data = await resp.json();

  if (!resp.ok) {
    throw new Error(data.error || `Request failed: ${url}`);
  }

  return data;
}

async function postJson(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await resp.json();

  if (!resp.ok) {
    throw new Error(data.error || `Request failed: ${url}`);
  }

  return data;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  const supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const startedAt = Date.now();
    const dumpMarker = await getDumpMarker();

    const startResp = await supabase.rpc("try_start_or_resume_dump_sync", {
      p_sync_key: SYNC_KEY,
      p_dump_marker: dumpMarker,
    });

    if (startResp.error) throw startResp.error;

    const state = Array.isArray(startResp.data) ? startResp.data[0] : startResp.data;
    const action = state?.action || "unknown";

    if (action === "already_synced" || action === "running_same" || action === "running_other") {
      return res.status(200).json({
        success: true,
        action,
        message: state?.message || "",
        dump_marker: dumpMarker,
        next_chunk_index: state?.next_chunk_index || 0,
        total_chunks: state?.total_chunks || 0,
      });
    }

    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    const baseUrl = `${proto}://${host}`;

    const refreshSuffix = action === "start" ? "?refresh=1" : "";
    const ordersData = await fetchJson(`${baseUrl}/api/all-orders${refreshSuffix}`);
    const orders = Array.isArray(ordersData.orders) ? ordersData.orders : [];
    const chunks = buildChunks(orders);

    let nextChunkIndex = Number(state?.next_chunk_index || 0);
    let merged = normalizeResult(state?.run_result);

    while (nextChunkIndex < chunks.length && (Date.now() - startedAt) < MAX_RUN_MS) {
      const chunk = chunks[nextChunkIndex];
      const chunkResult = await postJson(`${baseUrl}/api/bundle-engine`, { orders: chunk });

      mergeResults(merged, chunkResult.results || {});
      nextChunkIndex += 1;

      const progressResp = await supabase.rpc("update_dump_sync_progress", {
        p_sync_key: SYNC_KEY,
        p_dump_marker: dumpMarker,
        p_next_chunk_index: nextChunkIndex,
        p_total_chunks: chunks.length,
        p_total_orders: orders.length,
        p_run_result: merged,
      });

      if (progressResp.error) throw progressResp.error;
    }

    if (nextChunkIndex >= chunks.length) {
      const finalResult = {
        success: true,
        total_orders: orders.length,
        total_chunks: chunks.length,
        results: merged,
        finished_at: new Date().toISOString(),
      };

      const finishResp = await supabase.rpc("finish_dump_sync", {
        p_sync_key: SYNC_KEY,
        p_dump_marker: dumpMarker,
        p_result: finalResult,
      });

      if (finishResp.error) throw finishResp.error;

      return res.status(200).json({
        success: true,
        action,
        status: "completed",
        dump_marker: dumpMarker,
        total_orders: orders.length,
        total_chunks: chunks.length,
        results: merged,
      });
    }

    return res.status(200).json({
      success: true,
      action,
      status: "partial",
      dump_marker: dumpMarker,
      next_chunk_index: nextChunkIndex,
      total_chunks: chunks.length,
      total_orders: orders.length,
      results: merged,
    });
  } catch (err) {
    try {
      await supabase.rpc("fail_dump_sync", {
        p_sync_key: SYNC_KEY,
        p_result: {
          success: false,
          error: err.message,
          failed_at: new Date().toISOString(),
        },
      });
    } catch (_) {}

    console.error("cron-dump-sync error:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

export const config = { maxDuration: 60 };
