import { createClient } from '@supabase/supabase-js';

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

  const client = getSB();

  if (req.method === 'GET') {
    const { data, error } = await client.from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ logs: data });
  }

  if (req.method === 'POST') {
    const { user_name, message } = req.body;
    if (!user_name || !message) return res.status(400).json({ error: 'user_name and message required' });
    const { error } = await client.from('activity_logs').insert({ user_name, message });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
