(function () {
  const MAX_ORDERS_PER_CHUNK = 150;

  function normalizeCustomerId(v) {
    const s = String(v || "").trim();
    if (!s || s.toLowerCase() === "unknown" || s === "-") return null;
    return s;
  }

  function normalizeName(v) {
    const s = String(v || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return s || null;
  }

  function buildChunks(orders) {
    const nameToIds = {};

    orders.forEach((o) => {
      const id = normalizeCustomerId(o.customer_id);
      const name = normalizeName(o.customer_name);
      if (id && name) {
        if (!nameToIds[name]) nameToIds[name] = new Set();
        nameToIds[name].add(id);
      }
    });

    const groups = {};
    orders.forEach((o) => {
      const id = normalizeCustomerId(o.customer_id);
      const name = normalizeName(o.customer_name);

      let key;
      if (id) {
        key = "ID:" + id;
      } else if (name && nameToIds[name] && nameToIds[name].size === 1) {
        const knownId = Array.from(nameToIds[name])[0];
        key = "ID:" + knownId;
      } else if (name) {
        key = "NAME:" + name;
      } else {
        key = "UNKNOWN:" + o.fleek_id;
      }

      if (!groups[key]) groups[key] = [];
      groups[key].push(o);
    });

    const groupArrays = Object.values(groups);
    const chunks = [];
    let currentGroups = [];
    let currentCount = 0;

    for (const group of groupArrays) {
      if (currentCount + group.length > MAX_ORDERS_PER_CHUNK && currentGroups.length > 0) {
        chunks.push(currentGroups.flat());
        currentGroups = [group];
        currentCount = group.length;
      } else {
        currentGroups.push(group);
        currentCount += group.length;
      }
    }

    if (currentGroups.length > 0) {
      chunks.push(currentGroups.flat());
    }

    return chunks;
  }

  async function postJson(url, body) {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || ("Request failed: " + url));
    }
    return data;
  }

  async function runAutoDumpSync() {
    try {
      const startResp = await fetch("/api/dump-sync-start");
      const startData = await startResp.json();

      if (!startResp.ok) {
        console.error("dump-sync-start failed", startData);
        return;
      }

      if (startData.action === "already_synced") {
        console.log("Dump already synced:", startData.dump_marker);
        return;
      }

      if (startData.action === "running") {
        console.log("Sync already running by another user.");
        return;
      }

      if (startData.action !== "start") {
        console.log("No sync action needed.", startData);
        return;
      }

      console.log("Starting auto dump sync for marker:", startData.dump_marker);

      const ordersResp = await fetch("/api/all-orders?refresh=1");
      const ordersData = await ordersResp.json();

      if (!ordersResp.ok) {
        throw new Error(ordersData.error || "Failed to refresh orders");
      }

      const orders = ordersData.orders || [];
      const chunks = buildChunks(orders);

      const merged = {
        created: 0,
        locked_skipped: 0,
        ignored_singletons: 0,
        time_window_splits: 0,
        errors: [],
      };

      for (let i = 0; i < chunks.length; i++) {
        console.log("Processing chunk", i + 1, "of", chunks.length, "orders:", chunks[i].length);

        const result = await postJson("/api/bundle-engine", { orders: chunks[i] });
        const r = result.results || {};

        merged.created += Number(r.created || 0);
        merged.locked_skipped += Number(r.locked_skipped || 0);
        merged.ignored_singletons += Number(r.ignored_singletons || 0);
        merged.time_window_splits += Number(r.time_window_splits || 0);

        if (Array.isArray(r.errors) && r.errors.length) {
          merged.errors.push.apply(merged.errors, r.errors);
        }
      }

      await postJson("/api/dump-sync-finish", {
        dump_marker: startData.dump_marker,
        failed: false,
        result: {
          success: true,
          total_orders: orders.length,
          chunks: chunks.length,
          results: merged,
        },
      });

      console.log("Auto dump sync complete", merged);
    } catch (err) {
      console.error("Auto dump sync failed", err);

      try {
        await postJson("/api/dump-sync-finish", {
          failed: true,
          result: { error: err.message },
        });
      } catch (e) {
        console.error("Failed to release sync lock", e);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runAutoDumpSync);
  } else {
    runAutoDumpSync();
  }
})();
