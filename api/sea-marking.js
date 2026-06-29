import { createClient } from '@supabase/supabase-js';

const VALID = ['', 'Hold', 'Dispatched'];

let sb = null;
function getSB() {
  if (sb) return sb;
  sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return sb;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { fleek_id, packing_status, marked_by } = req.body;
  if (!fleek_id) return res.status(400).json({ error: 'fleek_id required' });
  if (!VALID.includes(packing_status)) return res.status(400).json({ error: 'Invalid status' });

  try {
    const { error } = await getSB().from('sea_order_markings').upsert({
      fleek_id,
      packing_status,
      marked_by: marked_by || 'unknown',
      updated_at: new Date().toISOString()
    }, { onConflict: 'fleek_id' });

    if (error) throw error;
    return res.status(200).json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
