import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

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

const BLOCKED_VENDORS = new Set(['fashion-fusion-2', 'alexprodshop', 'walitest', 'testfaez']);

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
const CACHE_TTL_MS = 30 * 60 * 1000;

let sheetsClient = null;
async function getSheets() {
  if (sheetsClient) return sheetsClient;
  const oauth = new google.auth.OAuth2(
    CONFIG.google.clientId,
    CONFIG.google.clientSecret,
    'https://developers.google.com/oauthplayground'
  );
  oauth.setCredentials({ refresh_token: CONFIG.google.refreshToken });
  await oauth.getAccessToken();
  sheetsClient = google.sheets({ version: 'v4', auth: oauth });
  return sheetsClient;
}

function clean(v) { return v == null || v === '' ? null : String(v).trim(); }
function num(v) { const n = Number(v); return isNaN(n) ? null : n; }
function bool(v) {
  const s = String(v || '').toLowerCase().trim();
  return s === 'true' || s === 'yes' || s === '1';
}

function normalizeCustomerId(v) {
  const s = String(v || '').trim();
  if (!s || s.toLowerCase() === 'unknown' || s === '-') return null;
  return s;
}

function normalizeName(v) {
  const s = String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return s || null;
}

async function fetchFreshData() {
  if (!CONFIG.google.spreadsheetId) {
    throw new Error('GOOGLE_SPREADSHEET_ID environment variable is not set');
  }

  let markings = {};
  let markedFleekIds = new Set();

  if (CONFIG.supabase.url && CONFIG.supabase.serviceKey) {
    const sb = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data } = await sb
      .from('order_markings')
      .select('fleek_id, packing_status, marking_text, marked_by, updated_at, bundle_id');

    (data || []).forEach(m => {
      markings[m.fleek_id] = m;

      const hasManualMarking =
        !!m.marking_text ||
        !!m.marked_by ||
        (m.packing_status && m.packing_status !== 'Pending');

      if (hasManualMarking) {
        markedFleekIds.add(m.fleek_id);
      }
    });
  }

  const client = await getSheets();
  const resp = await client.spreadsheets.values.get({
    spreadsheetId: CONFIG.google.spreadsheetId,
    range: `'${CONFIG.google.sheetName}'!${CONFIG.google.range}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const rows = (resp.data.values || []).slice(1);

  let filteredOrders = rows.map(r => {
    const fleek_id = clean(r[COLUMN_MAP.fleek_id]);
    if (!fleek_id) return null;

    const latest_status = clean(r[COLUMN_MAP.latest_status]);
    const qty = num(r[COLUMN_MAP.quantity_sold]);
    const hasMarking = markedFleekIds.has(fleek_id);
    const vendor_val = clean(r[COLUMN_MAP.vendor]);

    if (vendor_val && BLOCKED_VENDORS.has(vendor_val.toLowerCase())) return null;

    const statusOk = latest_status && ALLOWED_STATUSES.has(latest_status.toUpperCase());
    const isCancelled = latest_status && /cancel/i.test(latest_status);
    const qualifiesByStatus = statusOk && !isCancelled && (qty == null || qty <= MAX_QUANTITY);

    if (!qualifiesByStatus && !hasMarking) return null;

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
      product_type: clean(r[COLUMN_MAP.product_type]),
      quantity_sold: qty,
      vendor: clean(r[COLUMN_MAP.vendor]),
      vendor_zone: clean(r[COLUMN_MAP.vendor_zone]),
      is_zone_vendor: bool(r[COLUMN_MAP.is_zone_vendor]),
      bargain_bin_flag: bool(r[COLUMN_MAP.bargain_bin_flag]),
      zone_location: (function () {
        const v = clean(r[COLUMN_MAP.zone_location]);
        return (!v || v.toLowerCase() === 'false') ? 'ROW' : v;
      })(),
      packing_status: markings[fleek_id]?.packing_status || 'Pending',
      marking_updated_at: markings[fleek_id]?.updated_at || null,
      marking_updated_by: markings[fleek_id]?.marked_by || null,
      bundle_id: markings[fleek_id]?.bundle_id || null,
      _has_marking: hasMarking,
    };
  }).filter(Boolean);

  const nameToIds = {};
  filteredOrders.forEach(o => {
    const id = normalizeCustomerId(o.customer_id);
    const name = normalizeName(o.customer_name);

    if (id && name) {
      if (!nameToIds[name]) nameToIds[name] = new Set();
      nameToIds[name].add(id);
    }
  });

  const groups = {};
  filteredOrders.forEach(o => {
    const id = normalizeCustomerId(o.customer_id);
    const name = normalizeName(o.customer_name);

    let key;
    let match_basis;

    if (id) {
      key = 'ID:' + id;
      match_basis = 'customer_id';
    } else if (name && nameToIds[name] && nameToIds[name].size === 1) {
      const knownId = [...nameToIds[name]][0];
      key = 'ID:' + knownId;
      match_basis = 'name_to_known_customer_id';
    } else if (name) {
      key = 'NAME:' + name;
      match_basis = 'customer_name';
    } else {
      key = 'UNKNOWN:' + o.fleek_id;
      match_basis = 'unknown';
    }

    o.bundle_group_key = key;
    o.bundle_match_basis = match_basis;

    if (!groups[key]) groups[key] = [];
    groups[key].push(o);
  });

  const finalOrders = [];
  Object.values(groups).forEach(group => {
    const hasMarkedOrder = group.some(o => o._has_marking);
    const isBundleCandidate = group.length >= MIN_ORDERS_PER_CUSTOMER || hasMarkedOrder;

    if (isBundleCandidate) {
      group.forEach(o => {
        o.bundle_group_size = group.length;
        o.bundle_candidate = true;
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
