## 1) Premium Dark Theme (replace/add these Tailwind/CSS utility targets only)

```css
/* Root dark theme surface upgrades */
[data-theme="dark"] body,
[data-theme="dark"] html {
  background: #000000 !important;
  color: #ffffff !important;
}

/* Main wrappers / containers / cards */
[data-theme="dark"] .bg-white,
[data-theme="dark"] .bg-\[\#F9FAFB\],
[data-theme="dark"] .bg-gray-50,
[data-theme="dark"] .metric-card,
[data-theme="dark"] .tw,
[data-theme="dark"] .mb,
[data-theme="dark"] .mc,
[data-theme="dark"] #res > div,
[data-theme="dark"] #qcTC > div,
[data-theme="dark"] #znTC > div {
  background: #141414 !important;
  border-color: rgba(255,255,255,0.10) !important;
  color: #ffffff !important;
}

/* Table wrappers / header / footer */
[data-theme="dark"] .th,
[data-theme="dark"] .tf,
[data-theme="dark"] thead,
[data-theme="dark"] tbody,
[data-theme="dark"] table {
  background: #141414 !important;
  border-color: rgba(255,255,255,0.10) !important;
  color: #ffffff !important;
}

/* Rows */
[data-theme="dark"] .dr,
[data-theme="dark"] .data-row {
  background: #000000 !important;
  color: #e5e7eb !important;
}
[data-theme="dark"] .dr:hover,
[data-theme="dark"] .data-row:hover {
  background: #1a1a1a !important;
}

/* Inputs / selects */
[data-theme="dark"] input,
[data-theme="dark"] select,
[data-theme="dark"] .ssel,
[data-theme="dark"] .ai,
[data-theme="dark"] .ls input,
[data-theme="dark"] .cs input {
  background: #141414 !important;
  color: #ffffff !important;
  border-color: rgba(255,255,255,0.10) !important;
}
```

---

## 2) Ctrl+F Global Search Focus (add this JS listener only)

```js
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();

    const activeSearchMap = {
      dash: document.getElementById('sI'),
      qc: document.getElementById('qcSI'),
      zone: document.getElementById('znSI')
    };

    const targetInput = activeSearchMap[curScr] || document.getElementById('sI');
    if (targetInput) {
      targetInput.focus();
      targetInput.select?.();
      targetInput.closest('.cs, .ls')?.classList.add('cpulse');
      setTimeout(() => {
        targetInput.closest('.cs, .ls')?.classList.remove('cpulse');
      }, 600);
    }
  }
});
```

---

## 3) Bulk Selection & Multi-Status Update

### A) Row Checkbox HTML snippet (put in first column of each row)
```html
<td class="px-3 py-2.5 text-center">
  <input
    type="checkbox"
    class="order-checkbox w-4 h-4 rounded border-gray-300"
    data-fid="${esc(o.fleek_id)}"
  >
</td>
```

### B) Bulk Action bar HTML snippet (place above the table)
```html
<div class="flex flex-wrap items-center gap-2 mb-3 px-1">
  <span class="text-[11px] font-semibold text-gray-500">Bulk Action</span>
  <select id="bulkStatusSelect" class="ssel px-3 py-2 rounded-lg text-[11px]">
    ${STAT.map(s => `<option value="${s}">${s}</option>`).join('')}
  </select>
  <button
    type="button"
    onclick="applyBulkStatus()"
    class="px-3 py-2 rounded-lg text-[11px] font-semibold bg-gray-900 text-white"
  >
    Apply
  </button>
</div>
```

### C) JS bulk apply function only
```js
async function applyBulkStatus() {
  const selectedStatus = document.getElementById('bulkStatusSelect')?.value;
  const checked = [...document.querySelectorAll('.order-checkbox:checked')];

  if (!selectedStatus) return;
  if (!checked.length) {
    toast?.('No orders selected', 'error');
    return;
  }

  for (const cb of checked) {
    const fid = cb.dataset.fid;
    const order = orders.find(o => o.fleek_id === fid);
    if (!order) continue;

    order.packing_status = selectedStatus;
    order.marking_updated_at = new Date().toISOString();

    if (typeof mockSave === 'function') {
      await mockSave(fid, selectedStatus);
    }

    if (typeof pushLog === 'function' && currentUser) {
      pushLog(`${currentUser.name} changed ${fid} to "${selectedStatus}" via bulk action`);
    }
  }

  toast?.(`Updated ${checked.length} orders to "${selectedStatus}"`, 'success');
  updateKPI?.();

  if (typeof renderTable === 'function') renderTable();
  if (curScr === 'qc' && typeof renderZT === 'function') renderZT('qcTC', fOrders);
  if (curScr === 'zone' && typeof renderZT === 'function') renderZT('znTC', fOrders);
}
```