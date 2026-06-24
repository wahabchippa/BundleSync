import { createClient } from '@supabase/supabase-js';

// ============================================================
// VALID PACKING STATUS OPTIONS
// ============================================================

const VALID_STATUSES = [
  'Pending',
  'Hold for bundling',
  'Single dispatch lead time',
  'Single dispatch over weight',
  'Complete',
];

// ============================================================
// SUPABASE CLIENT
// ============================================================

let supabaseClient = null;

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Supabase credentials not configured');
  }

  supabaseClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return supabaseClient;
}

// ============================================================
// API HANDLER
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const supabase = getSupabaseClient();

    // GET: Retrieve marking/status
    if (req.method === 'GET') {
      const { fleek_id } = req.query;

      if (!fleek_id) {
        return res.status(400).json({ error: 'fleek_id required' });
      }

      const { data, error } = await supabase
        .from('order_markings')
        .select('*')
        .eq('fleek_id', fleek_id)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      return res.status(200).json({ 
        success: true, 
        marking: data || null,
        valid_statuses: VALID_STATUSES,
      });
    }

    // POST: Save/update packing status
    if (req.method === 'POST') {
      const { fleek_id, packing_status, marking_text, marked_by } = req.body;

      if (!fleek_id) {
        return res.status(400).json({ error: 'fleek_id required' });
      }

      // Validate packing status
      const status = packing_status || 'Pending';
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ 
          error: 'Invalid packing_status',
          valid_options: VALID_STATUSES,
        });
      }

      const { data, error } = await supabase
        .from('order_markings')
        .upsert(
          {
            fleek_id: String(fleek_id).trim(),
            packing_status: status,
            marking_text: marking_text || null,
            marked_by: marked_by || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'fleek_id' }
        )
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json({ success: true, data });
    }

    // DELETE: Remove marking
    if (req.method === 'DELETE') {
      const fleek_id = req.body?.fleek_id || req.query.fleek_id;

      if (!fleek_id) {
        return res.status(400).json({ error: 'fleek_id required' });
      }

      const { error } = await supabase
        .from('order_markings')
        .delete()
        .eq('fleek_id', fleek_id);

      if (error) throw error;

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Marking API error:', error);
    return res.status(500).json({ error: error.message });
  }
}

export const config = {
  maxDuration: 10,
};
