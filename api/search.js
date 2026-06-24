import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '13gjj21TS80z2HdNzWxl5Ciftfutd_4sHyEy_yJjvebM',
    sheetName: process.env.GOOGLE_SHEET_NAME || 'RAW DATA',
    range: 'A:CZ', // Extended to include Column CQ
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  app: {
    consolidationWindowDays: 5,
  },
};

// ============================================================
// COLUMN MAPPING — Updated with zone_location (Column CQ = index 94)
// ============================================================

const COLUMN_MAP = {
  created_at: 0,          // Column A
  order_number: 3,        // Column D
  fleek_id: 4,            // Column E (PRIMARY KEY)
  customer_id: 5,         // Column F
  customer_country: 7,    // Column H
  latest_status: 9,       // Column J
  latest_status_date: 10, // Column K
  item_name: 14,          // Column O
  category: 15,           // Column P
  product_type: 16,       // Column Q
  quantity_sold: 17,      // Column R
  vendor: 19,             // Column T
  vendor_zone: 20,        // Column U
  is_zone_vendor: 21,     // Column V
  qc_exclusion_type: 22,  // Column W
  bargain_bin_flag: 24,   // Column Y
  zone_location: 94,      // Column CQ - Zone Location (PK QC Center / PK Zone)
};

// ============================================================
// GOOGLE SHEETS OAUTH2 CLIENT
// ============================================================

let sheetsClient = null;
let oauth2Client = null;

async function getGoogleSheetsClient() {
  if (sheetsClient) return sheetsClient;

  if (!CONFIG.google.clientId || !CONFIG.google.clientSecret || !CONFIG.google.refreshToken) {
    throw new Error('Missing Google OAuth credentials');
  }

  oauth2Client = new google.auth.OAuth2(
    CONFIG.google.clientId,
    CONFIG.google.clientSecret,
    'https://developers.google.com/oauthplayground'
  );

  oauth2Client.setCredentials({
    refresh_token: CONFIG.google.refreshToken,
  });

  try {
    await oauth2Client.getAccessToken();
  } catch (err) {
    console.error('Token refresh failed:', err.message);
    throw new Error('Google OAuth token refresh failed');
  }

  sheetsClient = google.sheets({ version: 'v4', auth: oauth2Client });
  return sheetsClient;
}

// ============================================================
// SUPABASE CLIENT
// ============================================================

let supabaseClient = null;

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;

  if (!CONFIG.supabase.url || !CONFIG.supabase.serviceKey) {
    console.warn('Supabase not configured');
    return null;
  }

  supabaseClient = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return supabaseClient;
}

// ============================================================
// UTILITIES
// ============================================================

function parseBoolean(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'boolean') return value;
  const str = String(value).toLowerCase().trim();
  return str === 'true' || str === 'yes' || str === '1' || str === 'y';
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
}

function parseDate(value) {
  if (!value) return null;
  let date;
  if (typeof value === 'number') {
    date = new Date((value - 25569) * 86400 * 1000);
  } else {
    date = new Date(value);
  }
  return isNaN(date.getTime()) ? null : date;
}

function daysBetween(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.abs(d1 - d2) / (1000 * 60 * 60 * 24);
}

function cleanString(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim();
}

function extractRowData(row) {
  const get = (key) => cleanString(row[COLUMN_MAP[key]]);

  return {
    fleek_id: get('fleek_id'),
    order_number: get('order_number'),
    customer_id: get('customer_id'),
    created_at: get('created_at'),
    latest_status: get('latest_status'),
    latest_status_date: get('latest_status_date'),
    item_name: get('item_name'),
    category: get('category'),
    product_type: get('product_type'),
    quantity_sold: parseNumber(row[COLUMN_MAP.quantity_sold]),
    customer_country: get('customer_country'),
    vendor: get('vendor'),
    vendor_zone: get('vendor_zone'),
    is_zone_vendor: parseBoolean(row[COLUMN_MAP.is_zone_vendor]),
    qc_exclusion_type: get('qc_exclusion_type'),
    bargain_bin_flag: parseBoolean(row[COLUMN_MAP.bargain_bin_flag]),
    zone_location: get('zone_location'), // New field from Column CQ
  };
}

// ============================================================
// FETCH DATA FROM GOOGLE SHEETS
// ============================================================

async function fetchSheetData() {
  const client = await getGoogleSheetsClient();

  const response = await client.spreadsheets.values.get({
    spreadsheetId: CONFIG.google.spreadsheetId,
    range: `'${CONFIG.google.sheetName}'!${CONFIG.google.range}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const rows = response.data.values;

  if (!rows || rows.length < 2) {
    return [];
  }

  const dataRows = rows.slice(1);

  const orders = dataRows
    .map((row, index) => {
      const data = extractRowData(row);
      data._row_index = index + 2;
      return data;
    })
    .filter((order) => order.fleek_id);

  return orders;
}

// ============================================================
// FETCH MARKINGS FROM SUPABASE (Now includes packing_status)
// ============================================================

async function getMarkingsForFleekIds(fleekIds) {
  const supabase = getSupabaseClient();

  if (!supabase || !fleekIds || fleekIds.length === 0) {
    return {};
  }

  try {
    const { data, error } = await supabase
      .from('order_markings')
      .select('fleek_id, marking_text, packing_status, marked_by, updated_at')
      .in('fleek_id', fleekIds);

    if (error) {
      console.error('Supabase fetch error:', error);
      return {};
    }

    const markingsMap = {};
    (data || []).forEach((row) => {
      markingsMap[row.fleek_id] = {
        marking_text: row.marking_text,
        packing_status: row.packing_status || 'Pending',
        marked_by: row.marked_by,
        updated_at: row.updated_at,
      };
    });

    return markingsMap;
  } catch (err) {
    console.error('Supabase error:', err);
    return {};
  }
}

// ============================================================
// SEARCH & 7-DAY CONSOLIDATION LOGIC
// ============================================================

async function searchAndConsolidate(searchQuery) {
  const allOrders = await fetchSheetData();
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const searchedOrder = allOrders.find(
    (order) =>
      (order.fleek_id && order.fleek_id.toLowerCase() === normalizedQuery) ||
      (order.order_number && order.order_number.toLowerCase() === normalizedQuery)
  );

  if (!searchedOrder) {
    return { found: false, searchedOrder: null, relatedOrders: [] };
  }

  const customerId = searchedOrder.customer_id;
  const searchedDate = parseDate(searchedOrder.created_at);

  if (!customerId) {
    throw new Error(`Order "${searchQuery}" has no customer_id`);
  }

  if (!searchedDate) {
    throw new Error(`Order "${searchQuery}" has invalid created_at date`);
  }

  const windowDays = CONFIG.app.consolidationWindowDays;

  const relatedOrders = allOrders.filter((order) => {
    if (!order.customer_id) return false;
    if (order.customer_id.toLowerCase() !== customerId.toLowerCase()) return false;

    const orderDate = parseDate(order.created_at);
    if (!orderDate) return false;

    return daysBetween(searchedDate, orderDate) <= windowDays;
  });

  relatedOrders.sort((a, b) => {
    const dateA = parseDate(a.created_at);
    const dateB = parseDate(b.created_at);
    if (!dateA || !dateB) return 0;
    return dateA - dateB;
  });

  return {
    found: true,
    searchedOrder,
    relatedOrders,
    customerId,
    searchedDate: searchedOrder.created_at,
    windowDays,
  };
}

// ============================================================
// API HANDLER
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed',
      message: 'Use GET with ?fleek_id=XXX or ?order_number=XXX',
    });
  }

  try {
    const searchQuery = req.query.fleek_id || req.query.order_number || '';

    if (!searchQuery.trim()) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'fleek_id or order_number parameter is required',
      });
    }

    const result = await searchAndConsolidate(searchQuery.trim());

    if (!result.found) {
      return res.status(404).json({
        error: 'Not found',
        message: `Order "${searchQuery}" was not found.`,
        searched_query: searchQuery,
      });
    }

    const fleekIds = result.relatedOrders.map((o) => o.fleek_id).filter(Boolean);
    const markingsMap = await getMarkingsForFleekIds(fleekIds);

    const ordersWithMarkings = result.relatedOrders.map((order) => ({
      ...order,
      packing_status: markingsMap[order.fleek_id]?.packing_status || 'Pending',
      marking_updated_at: markingsMap[order.fleek_id]?.updated_at || null,
      marking_updated_by: markingsMap[order.fleek_id]?.marked_by || null,
    }));

    // Calculate zone counts
    const zoneCounts = {
      all: ordersWithMarkings.length,
      pk_qc_center: ordersWithMarkings.filter(o => o.zone_location === 'PK QC Center').length,
      pk_zone: ordersWithMarkings.filter(o => o.zone_location === 'PK Zone').length,
    };

    // Calculate status counts
    const statusCounts = {
      pending: ordersWithMarkings.filter(o => o.packing_status === 'Pending').length,
      hold_bundling: ordersWithMarkings.filter(o => o.packing_status === 'Hold for bundling').length,
      single_lead: ordersWithMarkings.filter(o => o.packing_status === 'Single dispatch lead time').length,
      single_weight: ordersWithMarkings.filter(o => o.packing_status === 'Single dispatch over weight').length,
      complete: ordersWithMarkings.filter(o => o.packing_status === 'Complete').length,
    };

    const summary = {
      total_orders: ordersWithMarkings.length,
      total_quantity: ordersWithMarkings.reduce((s, o) => s + (o.quantity_sold || 0), 0),
      unique_vendors: [...new Set(ordersWithMarkings.map((o) => o.vendor).filter(Boolean))].length,
      bargain_bin_count: ordersWithMarkings.filter((o) => o.bargain_bin_flag).length,
      complete_count: statusCounts.complete,
      zone_counts: zoneCounts,
      status_counts: statusCounts,
    };

    return res.status(200).json({
      success: true,
      searched_query: searchQuery,
      searched_fleek_id: result.searchedOrder.fleek_id,
      searched_order_number: result.searchedOrder.order_number,
      customer_id: result.customerId,
      customer_country: result.searchedOrder.customer_country,
      searched_date: result.searchedDate,
      window_days: result.windowDays,
      summary,
      orders: ordersWithMarkings,
    });
  } catch (error) {
    console.error('API Error:', error);

    if (error.message?.includes('invalid_grant') || error.code === 401) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Google OAuth token invalid or expired.',
      });
    }

    if (error.code === 403) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'No permission to access the spreadsheet.',
      });
    }

    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
}

export const config = {
  maxDuration: 30,
};
