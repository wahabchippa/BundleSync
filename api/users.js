import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET: Fetch all users
    if (req.method === 'GET') {
      const { data, error } = await sb
        .from('team_users')
        .select('id, name, pin, role')
        .order('id');
      if (error) throw error;
      return res.status(200).json({ success: true, users: data || [] });
    }

    // POST: Update PIN or create user
    if (req.method === 'POST') {
      const { action, name, pin, role } = req.body;

      if (action === 'reset_pin') {
        if (!name || !pin) return res.status(400).json({ error: 'name and pin required' });
        const { data, error } = await sb
          .from('team_users')
          .update({ pin, updated_at: new Date().toISOString() })
          .eq('name', name)
          .select()
          .single();
        if (error) throw error;
        return res.status(200).json({ success: true, user: data });
      }

      if (action === 'create') {
        if (!name) return res.status(400).json({ error: 'name required' });
        const { data, error } = await sb
          .from('team_users')
          .insert({ name, pin: pin || '1234', role: role || 'Employee' })
          .select()
          .single();
        if (error) throw error;
        return res.status(200).json({ success: true, user: data });
      }

      if (action === 'delete') {
        if (!name) return res.status(400).json({ error: 'name required' });
        const { error } = await sb.from('team_users').delete().eq('name', name);
        if (error) throw error;
        return res.status(200).json({ success: true });
      }

      return res.status(400).json({ error: 'unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('users API error:', e);
    return res.status(500).json({ error: e.message });
  }
}
