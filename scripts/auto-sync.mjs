import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

const BASE_URL = process.env.VERCEL_APP_URL;
const SHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || '13gjj21TS80z2HdNzWxl5Ciftfutd_4sHyEy_yJjvebM';
const SHEET_NAME = 'RAW DATA';
const SYNC_KEY = 'daily_dump';
const CHUNK_SIZE = 150;
const STALE_LOCK_HOURS = 2;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function getDumpMarker() {
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );

  oauth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  const sheets = google.sheets({ version: 'v4', auth: oauth });

  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${SHEET_NAME}'!A2`,
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  return String(resp.data.values?.[0]?.[0] || '').trim();
}

async function getSyncState() {
  const { data } = await supabase
    .from('sync_state')
    .select('last_dump_marker, is_running, updated_at')
    .eq('sync_key', SYNC_KEY)
    .maybeSingle();

  return data || null;
}

async function setLock() {
  const { error } = await supabase
    .from('sync_state')
    .upsert({
      sync_key: SYNC_KEY,
      is_running: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'sync_key' });

  if (error) throw error;
}

async function releaseLock(marker) {
  const { error } = await supabase
    .from('sync_state')
    .upsert({
      sync_key: SYNC_KEY,
      is_running: false,
      last_dump_marker: marker,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'sync_key' });

  if (error) throw error;
}

async function clearLockOnly() {
  await supabase
    .from('sync_state')
    .upsert({
      sync_key: SYNC_KEY,
      is_running: false,
      updated_at: new Date().toISOString()
    }, { onConflict: 'sync_key' });
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

function buildGroupedChunks(orders) {
  const nameToIds = {};

  orders.forEach(o => {
    const id = normalizeCustomerId(o.customer_id);
    const name = normalizeName(o.customer_name);

    if (id && name) {
      if (!nameToIds[name]) nameToIds[name] = new Set();
      nameToIds[name].add(id);
    }
  });

  const groups = {};
  orders.forEach(o => {
    const id = normalizeCustomerId(o.customer_id);
    const name = normalizeName(o.customer_name);

    let key;
    if (id) {
      key = 'ID:' + id;
    } else if (name && nameToIds[name] && nameToIds[name].size === 1) {
      key = 'ID:' + Array.from(nameToIds[name])[0];
    } else if (name) {
      key = 'NAME:' + name;
    } else {
      key = 'UNK:' + o.fleek_id;
    }

    if (!groups[key]) groups[key] = [];
    groups[key].push(o);
  });

  const groupArrays = Object.values(groups);
  const chunks = [];
  let current = [];
  let count = 0;

  for (const group of groupArrays) {
    if (count + group.length > CHUNK_SIZE && current.length > 0) {
      chunks.push(current);
      current = [];
      count = 0;
    }

    current.push(...group);
    count += group.length;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function main() {
  console.log('Auto sync starting...');

  const dumpMarker = await getDumpMarker();
  console.log('Dump marker:', dumpMarker);

  if (!dumpMarker) {
    console.log('No dump marker found. Exit.');
    process.exit(0);
  }

  const state = await getSyncState();

  if (state?.last_dump_marker === dumpMarker) {
    console.log('Already synced for this dump. Exit.');
    process.exit(0);
  }

  if (state?.is_running) {
    const updatedAt = state.updated_at ? new Date(state.updated_at).getTime() : 0;
    const ageHours = updatedAt ? ((Date.now() - updatedAt) / (1000 * 60 * 60)) : 999;

    if (ageHours < STALE_LOCK_HOURS) {
      console.log('Another sync is running. Exit.');
      process.exit(0);
    }

    console.log('Stale lock found. Continuing...');
  }

  await setLock();

  try {
    const ordersResp = await fetch(`${BASE_URL}/api/all-orders?refresh=1`);
    const ordersData = await ordersResp.json();

    if (!ordersResp.ok) {
      throw new Error(ordersData.error || 'Failed to fetch all-orders');
    }

    const orders = ordersData.orders || [];
    console.log('Orders:', orders.length);

    const chunks = buildGroupedChunks(orders);
    console.log('Chunks:', chunks.length);

    const merged = {
      created: 0,
      locked_skipped: 0,
      ignored_singletons: 0,
      time_window_splits: 0,
      errors: []
    };

    for (let i = 0; i < chunks.length; i++) {
      console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} orders)`);

      const r = await fetch(`${BASE_URL}/api/bundle-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: chunks[i] })
      });

      const d = await r.json();

      if (!r.ok) {
        throw new Error(d.error || `bundle-engine failed on chunk ${i + 1}`);
      }

      if (d.results) {
        merged.created += d.results.created || 0;
        merged.locked_skipped += d.results.locked_skipped || 0;
        merged.ignored_singletons += d.results.ignored_singletons || 0;
        merged.time_window_splits += d.results.time_window_splits || 0;

        if (Array.isArray(d.results.errors) && d.results.errors.length) {
          merged.errors.push(...d.results.errors);
        }
      }
    }

    await releaseLock(dumpMarker);

    console.log('Sync complete');
    console.log(JSON.stringify(merged, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Sync failed:', err.message);
    await clearLockOnly();
    process.exit(1);
  }
}

main();