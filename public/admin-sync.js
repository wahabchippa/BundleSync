(() => {
  // 1. ADMIN CHECK LOGIC — reads from sessionStorage where auth system stores user
  let isAdmin = false;

  try {
    const raw = sessionStorage.getItem('bs_u');
    if (raw) {
      const user = JSON.parse(raw);
      if (user && (user.role === 'Admin' || user.role === 'Manager')) {
        isAdmin = true;
      }
    }
  } catch (e) {
    // silent fail
  }

  // Emergency fallback via URL param
  if (!isAdmin) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('admin') !== '1') return;
  }

  // 2. BUNDLE SYNC LOGIC
  const CHUNK_SIZE = 50;
  let running = false;

  function normalizeCustomerId(v) {
    const s = String(v || '').trim();
    if (!s || s.toLowerCase() === 'unknown' || s === '-') return null;
    return s;
  }

  function normalizeName(v) {
    const s = String(v || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return s || null;
  }

  function buildGroupedChunks(orders) {
    const nameToIds = {};

    orders.forEach(o => {
      const id = normalizeCustomerId(o.customer_id);
      const name = normalizeName(o.customer_name);
      if (id && name) {
        if (!nameToIds[name]) nameToIds[name] = new Set();
        nameToIds[name].add(id);
      }
    });

    const groups = {};
    orders.forEach(o => {
      const id = normalizeCustomerId(o.customer_id);
      const name = normalizeName(o.customer_name);

      let key;
      if (id) {
        key = 'ID:' + id;
      } else if (name && nameToIds[name] && nameToIds[name].size === 1) {
        key = 'ID:' + Array.from(nameToIds[name])[0];
      } else if (name) {
        key = 'NAME:' + name;
      } else {
        key = 'UNK:' + o.fleek_id;
      }

      if (!groups[key]) groups[key] = [];
      groups[key].push(o);
    });

    const groupArrays = Object.values(groups);
    const chunks = [];
    let current = [];
    let count = 0;

    for (const group of groupArrays) {
      if (count + group.length > CHUNK_SIZE && current.length > 0) {
        chunks.push(current);
        current = [];
        count = 0;
      }
      current.push(...group);
      count += group.length;
    }

    if (current.length > 0) chunks.push(current);
    return chunks;
  }

  async function fetchJson(url) {
    const r = await fetch(url);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  }

  async function postJson(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const text = await r.text();
    let d;
    try {
      d = JSON.parse(text);
    } catch (e) {
      throw new Error(text.slice(0, 200) || 'Non-JSON response from server');
    }

    if (!r.ok) throw new Error(d.error || 'Request failed');
    return d;
  }

  // 3. BUTTON UI
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:99999;background:#111827;color:#fff;padding:12px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);width:280px;font-family:Arial,sans-serif;';

  const title = document.createElement('div');
  title.textContent = 'Admin Sync';
  title.style.cssText = 'font-weight:700;margin-bottom:8px;';

  const status = document.createElement('div');
  status.textContent = 'Ready';
  status.style.cssText = 'font-size:12px;opacity:.9;min-height:34px;margin-bottom:10px;line-height:1.4;';

  const btn = document.createElement('button');
  btn.textContent = 'Run Sync';
  btn.style.cssText = 'width:100%;border:0;border-radius:10px;padding:10px 12px;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;';

  btn.onclick = async () => {
    if (running) return;

    running = true;
    btn.disabled = true;
    btn.style.opacity = '0.7';

    try {
      status.textContent = 'Loading fresh orders...';

      const ordersData = await fetchJson('/api/all-orders?refresh=1');
      const orders = ordersData.orders || [];
      const chunks = buildGroupedChunks(orders);

      const merged = {
        created: 0,
        locked_skipped: 0,
        ignored_singletons: 0,
        time_window_splits: 0,
        already_bundled_skipped: 0,
        errors: []
      };

      for (let i = 0; i < chunks.length; i++) {
        status.textContent = 'Syncing chunk ' + (i + 1) + '/' + chunks.length + ' ...';

        const result = await postJson('/api/bundle-engine', { orders: chunks[i] });
        const r = result.results || {};

        merged.created += Number(r.created || 0);
        merged.locked_skipped += Number(r.locked_skipped || 0);
        merged.ignored_singletons += Number(r.ignored_singletons || 0);
        merged.time_window_splits += Number(r.time_window_splits || 0);
        merged.already_bundled_skipped += Number(r.already_bundled_skipped || 0);

        if (Array.isArray(r.errors) && r.errors.length) {
          merged.errors.push(...r.errors);
        }
      }

      status.textContent =
        'Done. Bundles: ' + merged.created +
        ', Singles: ' + merged.ignored_singletons +
        ', Locked skipped: ' + merged.locked_skipped +
        ', Already bundled: ' + merged.already_bundled_skipped;

      console.log('Admin sync result:', merged);
      alert('Sync complete');
    } catch (err) {
      console.error(err);
      status.textContent = 'Error: ' + err.message;
      alert('Sync failed: ' + err.message);
    } finally {
      running = false;
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  };

  wrap.appendChild(title);
  wrap.appendChild(status);
  wrap.appendChild(btn);
  document.body.appendChild(wrap);
})();
