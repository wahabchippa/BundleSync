import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    sheetName: process.env.GOOGLE_SHEET_NAME || 'RAW DATA',
    range: 'A:CZ',
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
};

const BUNDLE_WINDOW_DAYS = 3;
const MAX_BUNDLE_SIZE = 15;

const BLOCKED_VENDORS = new Set(['fashion-fusion-2', 'alexprodshop', 'walitest', 'testfaez']);
const ALLOWED_STATUSES = new Set([
  'ACCEPTED', 'CREATED', 'PICKUP_READY', 'PICKUP_SUCCESSFULL',
  'QC_PENDING', 'QC_APPROVED', 'QC_HOLD', 'PICKUP_FAILED', 'FIRST_REPLACEMENT'
]);

const COLUMN_MAP = {
  created_at: 0, order_number: 3, fleek_id: 4, latest_status: 5, latest_status_date: 6,
  item_name: 47, product_type: 48, customer_id: 49, customer_country: 50,
  vendor: 53, vendor_zone: 56, is_zone_vendor: 57, customer_name: 65,
  qc_exclusion_type: 84, quantity_sold: 87, bargain_bin_flag: 88, category: 89, zone_location: 94,
};

// ============================================================
// HELPERS
// ============================================================
function clean(v) { return v == null || v === '' ? null : String(v).trim(); }
function num(v) { const n = Number(v); return isNaN(n) ? null : n; }
function bool(v) { const s = String(v || '').toLowerCase().trim(); return s === 'true' || s === 'yes' || s === '1'; }

function normalizeCustomerId(v) {
  const s = String(v || '').trim();
  if (!s || s.toLowerCase() === 'unknown' || s === '-') return null;
  return s;
}

function normalizeName(v) {
  const s = String(v || '').toLowerCase().replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
  return s || null;
}

function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function daysDiff(d1, d2) {
  if (!d1 || !d2) return Infinity;
  return Math.abs((d1 - d2) / (24 * 60 * 60 * 1000));
}

function generateBundleId(customerKey, partIndex = 0) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  const clean = customerKey.replace(/[^a-z0-9]/gi, '').substring(0, 20);
  const part = partIndex > 0 ? `-P${partIndex}` : '';
  return `BND-${clean}-${timestamp}-${random}${part}`.toUpperCase();
}

// ============================================================
// GOOGLE SHEETS
// ============================================================
let sheetsClient = null;
async function getSheets() {
  if (sheetsClient) return sheetsClient;
  const oauth = new google.auth.OAuth2(CONFIG.google.clientId, CONFIG.google.clientSecret, 'https://developers.google.com/oauthplayground');
  oauth.setCredentials({ refresh_token: CONFIG.google.refreshToken });
  await oauth.getAccessToken();
  sheetsClient = google.sheets({ version: 'v4', auth: oauth });
  return sheetsClient;
}

async function fetchOrdersFromSheets() {
  if (!CONFIG.google.spreadsheetId) throw new Error('GOOGLE_SPREADSHEET_ID not set');

  const client = await getSheets();
  const resp = await client.spreadsheets.values.get({
    spreadsheetId: CONFIG.google.spreadsheetId,
    range: `'${CONFIG.google.sheetName}'!${CONFIG.google.range}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const rows = (resp.data.values || []).slice(1);

  return rows.map(r => {
    const fleek_id = clean(r[COLUMN_MAP.fleek_id]);
    if (!fleek_id) return null;

    const latest_status = clean(r[COLUMN_MAP.latest_status]);
    const qty = num(r[COLUMN_MAP.quantity_sold]);
    const vendor_val = clean(r[COLUMN_MAP.vendor]);

    if (vendor_val && BLOCKED_VENDORS.has(vendor_val.toLowerCase())) return null;

    const statusOk = latest_status && ALLOWED_STATUSES.has(latest_status.toUpperCase());
    const isCancelled = latest_status && /cancel/i.test(latest_status);
    if (!statusOk || isCancelled || (qty != null && qty > 100)) return null;

    return {
      fleek_id,
      order_number: clean(r[COLUMN_MAP.order_number]),
      customer_id: clean(r[COLUMN_MAP.customer_id]),
      customer_name: clean(r[COLUMN_MAP.customer_name]),
      customer_country: clean(r[COLUMN_MAP.customer_country]),
      created_at: clean(r[COLUMN_MAP.created_at]),
      latest_status,
      latest_status_date: clean(r[COLUMN_MAP.latest_status_date]),
      item_name: clean(r[COLUMN_MAP.item_name]),
      category: clean(r[COLUMN_MAP.category]),
      quantity_sold: qty,
      vendor: clean(r[COLUMN_MAP.vendor]),
      bargain_bin_flag: bool(r[COLUMN_MAP.bargain_bin_flag]),
      zone_location: (() => { const v = clean(r[COLUMN_MAP.zone_location]); return (!v || v.toLowerCase() === 'false') ? 'ROW' : v; })(),
    };
  }).filter(Boolean);
}

// ============================================================
// BUNDLE ENGINE (inline for cron)
// ============================================================
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
    const currDate = parseDate(orders[i].created_at);
    let fitsInGroup = false;
    for (const groupOrder of currentGroup) {
      if (daysDiff(parseDate(groupOrder.created_at), currDate) <= windowDays) {
        fitsInGroup = true;
        break;
      }
    }
    if (fitsInGroup) {
      currentGroup.push(orders[i]);
    } else {
      subGroups.push(currentGroup);
      currentGroup = [orders[i]];
    }
  }
  subGroups.push(currentGroup);
  return subGroups;
}

// ============================================================
// CRON HANDLER
// ============================================================
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Optional: verify cron secret or admin token
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  const isCron = req.headers['x-vercel-cron'] === '1';
  const isValidSecret = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCron && !isValidSecret && req.query.force !== '1') {
    return res.status(401).json({ error: 'Unauthorized. Use ?force=1 for manual trigger or set CRON_SECRET.' });
  }

  try {
    const supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // 1. Fetch all orders from Google Sheets
    const allOrders = await fetchOrdersFromSheets();
    const allFleekIds = allOrders.map(o => o.fleek_id).filter(Boolean);

    // 2. Fetch existing markings
    const { data: existingMarkings } = await supabase
      .from('order_markings')
      .select('fleek_id, bundle_id, packing_status')
      .in('fleek_id', allFleekIds);

    const markingsMap = {};
    (existingMarkings || []).forEach(m => { markingsMap[m.fleek_id] = m; });

    // 3. Check locked bundles
    const bundleIdsToCheck = [...new Set((existingMarkings || []).map(m => m.bundle_id).filter(Boolean))];
    const lockedBundleIds = new Set();
    const unlockedBundleIds = new Set();

    if (bundleIdsToCheck.length > 0) {
      const { data: bundlesData } = await supabase
        .from('order_bundles')
        .select('bundle_id, is_locked, status')
        .in('bundle_id', bundleIdsToCheck);

      (bundlesData || []).forEach(b => {
        if (b.is_locked || b.status === 'Complete' || b.status === 'Locked') {
          lockedBundleIds.add(b.bundle_id);
        } else {
          unlockedBundleIds.add(b.bundle_id);
        }
      });
    }

    // 4. Filter eligible orders
    const eligibleOrders = allOrders.filter(o => {
      const marking = markingsMap[o.fleek_id];
      if (!marking) return true;
      if (!marking.bundle_id) return true;
      if (lockedBundleIds.has(marking.bundle_id)) return false;
      if (unlockedBundleIds.has(marking.bundle_id)) return false;
      return true;
    });

    // 5. Group by customer
    const nameToIds = {};
    eligibleOrders.forEach(o => {
      const id = normalizeCustomerId(o.customer_id);
      const name = normalizeName(o.customer_name);
      if (id && name) {
        if (!nameToIds[name]) nameToIds[name] = new Set();
        nameToIds[name].add(id);
      }
    });

    const customerGroups = {};
    eligibleOrders.forEach(o => {
      const id = normalizeCustomerId(o.customer_id);
      const name = normalizeName(o.customer_name);
      let key;
      if (id) key = 'ID:' + id;
      else if (name && nameToIds[name]?.size === 1) key = 'ID:' + [...nameToIds[name]][0];
      else if (name) key = 'NAME:' + name;
      else key = 'UNKNOWN:' + o.fleek_id;

      if (!customerGroups[key]) customerGroups[key] = [];
      customerGroups[key].push(o);
    });

    // 6. Create bundles
    const results = {
      created: 0,
      locked_skipped: 0,
      ignored_singletons: 0,
      time_window_splits: 0,
      oversized_splits: 0,
      already_bundled_skipped: allOrders.length - eligibleOrders.length,
      errors: [],
      bundles_created: [],
    };

    for (const [customerKey, customerOrders] of Object.entries(customerGroups)) {
      let timeSubGroups = groupOrdersByTimeWindow(customerOrders, BUNDLE_WINDOW_DAYS);

      if (timeSubGroups.length > 1) results.time_window_splits += timeSubGroups.length - 1;

      // Split oversized groups
      const finalGroups = [];
      for (const g of timeSubGroups) {
        if (g.length > MAX_BUNDLE_SIZE) {
          for (let i = 0; i < g.length; i += MAX_BUNDLE_SIZE) {
            finalGroups.push(g.slice(i, i + MAX_BUNDLE_SIZE));
          }
          results.oversized_splits += Math.ceil(g.length / MAX_BUNDLE_SIZE) - 1;
        } else {
          finalGroups.push(g);
        }
      }

      let partIndex = 0;
      for (const subGroup of finalGroups) {
        if (subGroup.length < 2) {
          results.ignored_singletons += subGroup.length;
          continue;
        }

        partIndex++;
        const newBundleId = generateBundleId(customerKey, partIndex > 1 ? partIndex : 0);
        const customerName = subGroup[0].customer_name || customerKey;

        const { error: bundleError } = await supabase.from('order_bundles').insert({
          bundle_id: newBundleId,
          customer_name: customerName,
          customer_id: subGroup[0].customer_id || null,
          status: 'Pending',
          is_locked: true,
        });

        if (bundleError) {
          results.errors.push(`Bundle create error: ${bundleError.message}`);
          continue;
        }

        results.created++;
        results.bundles_created.push({
          bundle_id: newBundleId,
          customer: customerName,
          orders: subGroup.length,
        });

        // Batch upsert markings
        const markingsToUpsert = subGroup.map(order => ({
          fleek_id: order.fleek_id,
          bundle_id: newBundleId,
          packing_status: markingsMap[order.fleek_id]?.packing_status || 'Pending',
          updated_at: new Date().toISOString(),
        }));

        const { error: upsertError } = await supabase
          .from('order_markings')
          .upsert(markingsToUpsert, { onConflict: 'fleek_id' });

        if (upsertError) {
          results.errors.push(`Batch upsert error: ${upsertError.message}`);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Auto-sync complete',
      timestamp: new Date().toISOString(),
      total_orders: allOrders.length,
      eligible_orders: eligibleOrders.length,
      results,
    });

  } catch (err) {
    console.error('Cron sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { maxDuration: 60 };
