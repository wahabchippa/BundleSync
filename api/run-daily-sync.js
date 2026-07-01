export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers.host;
    const baseUrl = `${proto}://${host}`;

    const ordersResp = await fetch(`${baseUrl}/api/all-orders?refresh=1`);
    const ordersData = await ordersResp.json();

    if (!ordersResp.ok) {
      return res.status(ordersResp.status).json({
        success: false,
        step: "all-orders",
        error: ordersData.error || "Failed to fetch orders"
      });
    }

    const bundleResp = await fetch(`${baseUrl}/api/bundle-engine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ orders: ordersData.orders || [] })
    });

    const bundleData = await bundleResp.json();

    if (!bundleResp.ok) {
      return res.status(bundleResp.status).json({
        success: false,
        step: "bundle-engine",
        total_orders: ordersData.total || 0,
        error: bundleData.error || "Failed to run bundle engine",
        details: bundleData
      });
    }

    return res.status(200).json({
      success: true,
      message: "Daily sync complete",
      total_orders: ordersData.total || 0,
      bundle_result: bundleData
    });
  } catch (err) {
    console.error("run-daily-sync error:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

export const config = { maxDuration: 60 };
