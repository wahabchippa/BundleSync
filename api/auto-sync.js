// DEPRECATED: Use /api/cron-sync instead
// This file is kept for backward compatibility but redirects to cron-sync

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  return res.status(200).json({
    success: true,
    message: 'Auto-sync is now handled by frontend. Use /api/cron-sync for manual trigger.',
    deprecated: true,
    use_instead: '/api/cron-sync?force=1'
  });
}

export const config = { maxDuration: 10 };
