import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

let sheetsClient = null;
async function getSheets() {
  if (sheetsClient) return sheetsClient;
  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );
  oauth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  await oauth.getAccessToken();
  sheetsClient = google.sheets({ version: 'v4', auth: oauth });
  return sheetsClient;
}

async function getDumpMarker() {
  const client = await getSheets();
  const resp = await client.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || '13gjj21TS80z2HdNzWxl5Ciftfutd_4sHyEy_yJjvebM',
    range: "'RAW DATA'!A2",
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return String(resp.data.values?.[0]?.[0] || '').trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Step 1: A2 marker check karo
    const dumpMarker = await getDumpMarker();
    if (!dumpMarker) {
      return res.status(400).json({ success: false, error: 'A2 marker missing in sheet' });
    }

    // Step 2: Check karo ke ye dump pehle sync ho chuki hai
    const { data: syncState } = await supabase
      .from('sync_state')
      .select('last_dump_marker, is_running')
      .eq('sync_key', 'daily_dump')
      .single();

    if (syncState?.last_dump_marker === dumpMarker) {
      return res.status(200).json({
        success: true,
        status: 'already_synced',
        message: 'Ye dump pehle sync ho chuki hai',
        dump_marker: dumpMarker
      });
    }

    if (syncState?.is_running) {
      return res.status(200).json({
        success: true,
        status: 'running',
        message: 'Sync pehle se chal rahi hai',
        dump_marker: dumpMarker
      });
    }

    // Step 3: Lock lagao
    await supabase.from('sync_state').upsert({
      sync_key: 'daily_dump',
      is_running: true,
      last_dump_marker: syncState?.last_dump_marker || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'sync_key' });

    // Step 4: Orders fetch karo
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const baseUrl = `${proto}://${host}`;

    const ordersResp = await fetch(`${baseUrl}/api/all-orders?refresh=1`);
    const ordersData = await ordersResp.json();
    const orders = ordersData.orders || [];

    // Step 5: Chunks banao (120 orders each)
    const chunks = [];
    for (let i = 0; i < orders.length; i += 120) {
      chunks.push(orders.slice(i, i + 120));
    }

    // Step 6: Har chunk bundle-engine ko bhejo
    const merged = { created: 0, locked_skipped: 0, ignored_singletons: 0, errors: [] };

    for (const chunk of chunks) {
      const r = await fetch(`${baseUrl}/api/bundle-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: chunk })
      });
      const d = await r.json();
      if (d.results) {
        merged.created += d.results.created || 0;
        merged.locked_skipped += d.results.locked_skipped || 0;
        merged.ignored_singletons += d.results.ignored_singletons || 0;
        if (d.results.errors?.length) merged.errors.push(...d.results.errors);
      }
    }

    // Step 7: Lock hatao aur marker save karo
    await supabase.from('sync_state').upsert({
      sync_key: 'daily_dump',
      is_running: false,
      last_dump_marker: dumpMarker,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'sync_key' });

    return res.status(200).json({
      success: true,
      status: 'completed',
      dump_marker: dumpMarker,
      total_orders: orders.length,
      total_chunks: chunks.length,
      results: merged
    });

  } catch (err) {
    // Error pe lock hatao
    await supabase.from('sync_state').upsert({
      sync_key: 'daily_dump',
      is_running: false,
      updated_at: new Date().toISOString()
    }, { onConflict: 'sync_key' }).catch(() => {});

    return res.status(500).json({ success: false, error: err.message });
  }
}

export const config = { maxDuration: 60 };