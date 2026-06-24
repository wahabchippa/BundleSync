import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const CONFIG = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '13gjj21TS80z2HdNzWxl5Ciftfutd_4sHyEy_yJjvebM',
    sheetName: process.env.GOOGLE_SHEET_NAME || 'RAW DATA',
    range: 'A:CZ',
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
};

const ALLOWED_STATUSES = new Set([
  'ACCEPTED', 'CREATED', 'PICKUP_READY', 'PICKUP_SUCCESSFULL',
  'QC_PENDING', 'QC_APPROVED', 'QC_HOLD', 'PICKUP_FAILED', 'FIRST_REPLACEMENT'
]);

const MAX_QUANTITY = 100;
const MIN_ORDERS_PER_CUSTOMER = 2;

const COLUMN_MAP = {
  created_at: 0, order_number: 3, fleek_id: 4, latest_status: 5, latest_status_date: 6,
  item_name: 47, product_type: 48, customer_id: 49, customer_country: 50,
  vendor: 53, vendor_zone: 56, is_zone_vendor: 57, customer_name: 65,
  qc_exclusion_type: 84, quantity_sold: 87, bargain_bin_flag: 88, category: 89, zone_location: 94,
};

let cache = { data: null, timestamp: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000;

let sheetsClient = null;
async function getSheets() {
  if (sheetsClient) return sheetsClient;
  const oauth = new google.auth.OAuth2(CONFIG.google.clientId, CONFIG.google.clientSecret, 'https://developers.google.com/oauthplayground');
  oauth.setCredentials({ refresh_token: CONFIG.google.refreshToken });
  await oauth.getAccessToken();
  sheetsClient = google.sheets({ version: 'v4', auth: oauth });
  return sheetsClient;
}

function clean(v) { return v == null || v === '' ? null : String(v).trim(); }
function num(v) { const n = Number(v); return isNaN(n) ? null : n; }
function bool(v) { const s = String(v || '').toLowerCase().trim(); return s === 'true' || s === 'yes' || s === '1'; }

async function fetchFreshData() {
  // 1. Get markings from Supabase
  let markings = {};
  let markedFleekIds = new Set();
  if (CONFIG.supabase.url && CONFIG.supabase.serviceKey) {
    const sb = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data } = await sb.from('order_markings').select('fleek_id, packing_status, marked_by, updated_at');
    (data || []).forEach(m => {
      markings[m.fleek_id] = m;
      markedFleekIds.add(m.fleek_id);
    });
  }

  // 2. Fetch sheet
  const client = await getSheets();
  const resp = await client.spreadsheets.values.get({
    spreadsheetId: CONFIG.google.spreadsheetId,
    range: `'${CONFIG.google.sheetName}'!${CONFIG.google.range}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const rows = (resp.data.values || []).slice(1);

  // 3. FILTER 1 (Status) + FILTER 2 (Quantity ≤ 100) + has marking exception
  let filteredOrders = rows.map(r => {
    const fleek_id = clean(r[COLUMN_MAP.fleek_id]);
    if (!fleek_id) return null;

    const latest_status = clean(r[COLUMN_MAP.latest_status]);
    const qty = num(r[COLUMN_MAP.quantity_sold]);
    const hasMarking = markedFleekIds.has(fleek_id);
    const statusOk = latest_status && ALLOWED_STATUSES.has(latest_status.toUpperCase());

    // Status OK + qty OK
    const qualifiesByStatus = statusOk && (qty == null || qty <= MAX_QUANTITY);

    // Always include if has marking (even if qty > 100 or status changed)
    if (!qualifiesByStatus && !hasMarking) return null;

    return {
      fleek_id,
      order_number: clean(r[COLUMN_MAP.order_number]),
      customer_id: clean(r[COLUMN_MAP.customer_id]),
      customer_name: clean(r[COLUMN_MAP.customer_name]),
      customer_country: clean(r[COLUMN_MAP.customer_country]),
      created_at: clean(r[COLUMN_MAP.created_at]),
      latest_status,
      item_name: clean(r[COLUMN_MAP.item_name]),
      category: clean(r[COLUMN_MAP.category]),
      product_type: clean(r[COLUMN_MAP.product_type]),
      quantity_sold: qty,
      vendor: clean(r[COLUMN_MAP.vendor]),
      vendor_zone: clean(r[COLUMN_MAP.vendor_zone]),
      is_zone_vendor: bool(r[COLUMN_MAP.is_zone_vendor]),
      bargain_bin_flag: bool(r[COLUMN_MAP.bargain_bin_flag]),
      zone_location: clean(r[COLUMN_MAP.zone_location]),
      packing_status: markings[fleek_id]?.packing_status || 'Pending',
      marking_updated_at: markings[fleek_id]?.updated_at || null,
      marking_updated_by: markings[fleek_id]?.marked_by || null,
      _has_marking: hasMarking,
    };
  }).filter(Boolean);

  // 4. FILTER 3: Group by customer (name preferred, fallback to id), keep only customers with 2+ orders
  const groups = {};
  filteredOrders.forEach(o => {
    const key = (o.customer_name && o.customer_name.trim())
      ? 'NAME:' + o.customer_name.trim().toLowerCase()
      : 'ID:' + (o.customer_id || 'UNKNOWN');
    if (!groups[key]) groups[key] = [];
    groups[key].push(o);
  });

  const finalOrders = [];
  Object.values(groups).forEach(group => {
    // Keep if 2+ orders OR any order has marking
    const hasMarkedOrder = group.some(o => o._has_marking);
    if (group.length >= MIN_ORDERS_PER_CUSTOMER || hasMarkedOrder) {
      group.forEach(o => {
        delete o._has_marking;
        finalOrders.push(o);
      });
    }
  });

  return finalOrders;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const forceRefresh = req.query.refresh === '1';
    const now = Date.now();
    const cacheAge = now - cache.timestamp;
    const cacheValid = cache.data && cacheAge < CACHE_TTL_MS && !forceRefresh;

    let orders;
    let fromCache = false;

    if (cacheValid) {
      orders = cache.data;
      fromCache = true;
    } else {
      orders = await fetchFreshData();
      cache = { data: orders, timestamp: now };
    }

    return res.status(200).json({
      success: true,
      total: orders.length,
      from_cache: fromCache,
      cache_age_seconds: fromCache ? Math.floor(cacheAge / 1000) : 0,
      filters_applied: {
        max_quantity: MAX_QUANTITY,
        min_orders_per_customer: MIN_ORDERS_PER_CUSTOMER,
        allowed_statuses: [...ALLOWED_STATUSES],
      },
      orders,
    });
  } catch (e) {
    console.error('all-orders error:', e);
    return res.status(500).json({ error: e.message });
  }
}

export const config = { maxDuration: 60 };
