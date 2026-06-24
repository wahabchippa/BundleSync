export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const status = {
    ok: true,
    timestamp: new Date().toISOString(),
    env: process.env.VERCEL_ENV || 'development',
    services: {
      google: !!(
        process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_REFRESH_TOKEN
      ),
      supabase: !!(
        process.env.SUPABASE_URL &&
        process.env.SUPABASE_SERVICE_ROLE_KEY
      ),
    },
  };

  status.ok = status.services.google && status.services.supabase;

  return res.status(status.ok ? 200 : 503).json(status);
}
