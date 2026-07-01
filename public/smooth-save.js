// BundleSync Smooth Save Fix
// Replaces full re-render after save with in-place row update

(function() {
  const _origSaveStatus = window.saveStatus;

  window.saveStatus = async function(fleekId) {
    const btn = document.getElementById('btn-' + fleekId);
    const select = document.getElementById('status-' + fleekId);

    if (!btn || !select) {
      if (_origSaveStatus) return _origSaveStatus(fleekId);
      return;
    }

    const newStatus = select.value;

    // Show loading state
    const icSave = btn.querySelector('.ic-save');
    const icLoad = btn.querySelector('.ic-load');
    if (icSave) icSave.classList.add('hidden');
    if (icLoad) icLoad.classList.remove('hidden');
    btn.disabled = true;

    try {
      const res = await fetch('/api/marking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fleek_id: fleekId,
          packing_status: newStatus,
          marked_by: window.currentUser || 'admin'
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');

      // In-place update — NO full re-render
      select.dataset.packingStatus = newStatus;

      // Update countdown state
      const isHold = newStatus === 'Hold for bundling';
      select.dataset.holdCountdown = isHold ? 'true' : 'false';

      // Update row class smoothly
      const row = btn.closest('tr');
      if (row) {
        // Remove old status classes
        row.classList.remove('sla-breach', 'sla-breach-pulse');

        // Update packing status class on select
        if (window.packingStatusClass) {
          const newClass = window.packingStatusClass(newStatus);
          select.className = 'status-select flex-1 px-2.5 py-1.5 border rounded-lg cursor-pointer ' + newClass;
        }

        // Update hold countdown text in row
        const countdownEl = row.querySelector('[data-hold-countdown]');
        if (countdownEl) {
          countdownEl.dataset.packingStatus = newStatus;
          countdownEl.dataset.holdCountdown = isHold ? 'true' : 'false';

          if (!isHold) {
            // Find countdown text element and clear it
            const dateCell = row.querySelector('td:nth-child(2) p:last-child');
            if (dateCell) dateCell.textContent = '\u2014';
          }
        }

        // Update "Updated" timestamp in row
        const updatedEl = row.querySelector('td:last-child p');
        if (updatedEl) {
          const now = new Date();
          const formatted = now.toLocaleString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
          });
          updatedEl.textContent = 'Updated: ' + formatted;
        }
      }

      // Update in-memory orders array
      if (window.orders) {
        const order = window.orders.find(o => o.fleek_id === fleekId);
        if (order) order.packing_status = newStatus;
      }
      if (window.filteredOrders) {
        const order = window.filteredOrders.find(o => o.fleek_id === fleekId);
        if (order) order.packing_status = newStatus;
      }

      // Brief green flash on button (no blink)
      btn.style.background = '#16a34a';
      setTimeout(() => { btn.style.background = ''; }, 800);

    } catch (err) {
      console.error('Save failed:', err);
      alert('Save failed: ' + err.message);
      // Revert select
      if (window.orders) {
        const order = window.orders.find(o => o.fleek_id === fleekId);
        if (order && select) select.value = order.packing_status || 'Pending';
      }
    } finally {
      if (icSave) icSave.classList.remove('hidden');
      if (icLoad) icLoad.classList.add('hidden');
      btn.disabled = false;
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