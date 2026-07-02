// BundleSync Smooth Save Fix
// Replaces full re-render after save with in-place row update
// Compatible with index.html's saveSt() flow

(function() {
  // Store original mSave (marking API wrapper)
  const _origMSave = window.mSave;

  window.mSave = async function(fleekId, newStatus) {
    // Find the correct button and select for this fleekId
    const btn = document.getElementById('b-' + fleekId) ||
                document.getElementById('zb-' + fleekId) ||
                document.getElementById('sb-' + fleekId);

    const select = document.getElementById('st-' + fleekId) ||
                   document.getElementById('zst-' + fleekId) ||
                   document.getElementById('sst-' + fleekId);

    // Show loading state on button
    if (btn) {
      const icSave = btn.querySelector('._s');
      const icLoad = btn.querySelector('._l');
      if (icSave) icSave.classList.add('hidden');
      if (icLoad) icLoad.classList.remove('hidden');
      btn.disabled = true;
    }

    try {
      // Call original API
      const res = await fetch('/api/marking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fleek_id: fleekId,
          packing_status: newStatus,
          marked_by: (window.cu && window.cu.name) || 'unknown'
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');

      // In-place update — NO full re-render
      if (select) {
        select.dataset.packingStatus = newStatus;
        // Update visual class
        if (window.pC) {
          const prefix = select.id.startsWith('zst-') || select.id.startsWith('sst-') ? 'ssel flex-1 px-2.5 py-1.5 rounded-lg cursor-pointer ' : 'ssel flex-1 px-2.5 py-1.5 rounded-lg cursor-pointer ';
          select.className = (prefix + window.pC(newStatus)).trim();
        }
      }

      // Update row styling
      const row = btn ? btn.closest('tr') : document.querySelector(`[data-fid="${fleekId}"]`);
      if (row) {
        // Remove old SLA breach classes
        row.classList.remove('sla-breach', 'sla-breach-pulse');

        // Update "Marked" timestamp in row if exists
        const markedEls = row.querySelectorAll('div');
        markedEls.forEach(el => {
          if (el.textContent && el.textContent.includes('Marked:')) {
            const now = new Date();
            const fd = window.fd || ((d) => new Date(d).toLocaleDateString('en-GB', {day:'2-digit', month:'short'}));
            el.textContent = '✓ Marked: ' + fd(now.toISOString());
            el.style.color = '#10b981';
          }
        });
      }

      // Update in-memory arrays
      if (window.orders) {
        const order = window.orders.find(o => o.fleek_id === fleekId);
        if (order) {
          order.packing_status = newStatus;
          order.marking_updated_at = new Date().toISOString();
        }
      }
      if (window.seaOrders) {
        const so = window.seaOrders.find(o => o.fleek_id === fleekId);
        if (so) {
          so.packing_status = newStatus;
          so.marking_updated_at = new Date().toISOString();
        }
      }

      // Brief green flash on button
      if (btn) {
        const origBg = btn.style.background;
        btn.style.background = '#16a34a';
        setTimeout(() => { btn.style.background = origBg; }, 800);
      }

      return data;
    } catch (err) {
      console.error('Save failed:', err);
      // Revert select on error
      if (select && window.orders) {
        const order = window.orders.find(o => o.fleek_id === fleekId);
        if (order) select.value = order.packing_status || 'Pending';
      }
      throw err;
    } finally {
      if (btn) {
        const icSave = btn.querySelector('._s');
        const icLoad = btn.querySelector('._l');
        if (icSave) icSave.classList.remove('hidden');
        if (icLoad) icLoad.classList.add('hidden');
        btn.disabled = false;
      }
    }
  };

  // Smooth countdown ticker - only update text, no DOM restructure
  function smoothCountdownTick() {
    document.querySelectorAll('[data-hold-countdown="true"]').forEach(el => {
      const createdAt = el.dataset.createdAt;
      const packingStatus = el.dataset.packingStatus;

      if (!createdAt || packingStatus !== 'Hold for bundling') return;

      const SLA_MS = 72 * 60 * 60 * 1000;
      const created = new Date(createdAt);
      if (isNaN(created.getTime())) return;

      const remaining = SLA_MS - (Date.now() - created.getTime());
      const isBreached = remaining <= 0;

      const row = el.closest('tr');

      // Only update text — no innerHTML replace
      const dateCell = row && row.querySelector('td:nth-child(2) p:last-child');
      if (dateCell) {
        if (isBreached) {
          dateCell.textContent = '0h 0m left';
          dateCell.classList.add('text-red-600', 'font-bold');
          dateCell.classList.remove('text-gray-400');
        } else {
          const totalMin = Math.floor(remaining / 60000);
          const h = Math.floor(totalMin / 60);
          const m = totalMin % 60;
          dateCell.textContent = h + 'h ' + m + 'm left';
        }
      }

      if (row) {
        row.classList.toggle('sla-breach', isBreached);
        row.classList.toggle('sla-breach-pulse', isBreached);
      }

      const slaBadge = row && row.querySelector('[data-sla-badge="true"]');
      if (slaBadge) slaBadge.classList.toggle('hidden', !isBreached);
    });
  }

  // Replace old interval with smooth one
  if (window.holdCountdownInterval) {
    clearInterval(window.holdCountdownInterval);
  }
  window.holdCountdownInterval = setInterval(smoothCountdownTick, 60000);
})();
