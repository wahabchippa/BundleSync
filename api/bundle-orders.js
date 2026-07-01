import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { fleek_id, bundle_id } = req.query;

    let targetBundleId = bundle_id;

    if (!targetBundleId && fleek_id) {
      const { data: marking } = await supabase
        .from('order_markings')
        .select('bundle_id')
        .eq('fleek_id', fleek_id)
        .maybeSingle();

      targetBundleId = marking?.bundle_id || null;
    }

    if (!targetBundleId) {
      return res.status(200).json({
        success: true,
        in_bundle: false,
        bundle_id: null,
        orders: []
      });
    }

    const { data: bundleInfo } = await supabase
      .from('order_bundles')
      .select('bundle_id, customer_name, customer_id, status, is_locked')
      .eq('bundle_id', targetBundleId)
      .maybeSingle();

    const { data: bundleOrders } = await supabase
      .from('order_markings')
      .select('fleek_id, packing_status, marked_by, updated_at')
      .eq('bundle_id', targetBundleId)
      .order('updated_at', { ascending: false });

    return res.status(200).json({
      success: true,
      in_bundle: true,
      bundle_id: targetBundleId,
      bundle_info: bundleInfo || {},
      orders: bundleOrders || []
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

export const config = { maxDuration: 15 };