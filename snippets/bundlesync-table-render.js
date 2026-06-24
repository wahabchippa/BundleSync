// ============================================================
// BUNDLESYNC — TABLE RENDER / 5-DAY BUNDLE / LIVE COUNTDOWN
// Replace your existing renderTable()/row() logic with this block.
// Depends on existing helpers/state:
//   orders, filteredOrders, searchData, PACKING_STATUSES,
//   packingStatusClass(), statusCfg(), saveStatus(),
//   fmtDate(), fmtDateTime(), esc(), $()
// ============================================================

let bundleBuyerMeta = {};
let holdCountdownInterval = null;

function getDateValue(dateStr) {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

function diffDaysAbs(a, b) {
    const d1 = getDateValue(a);
    const d2 = getDateValue(b);
    if (!d1 || !d2) return Number.POSITIVE_INFINITY;
    return Math.abs(d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24);
}

// Build sequential 5-day bundles per customer.
// If a later order is 6+ days away from the anchor of the current bundle,
// it starts a NEW bundle and gets a NEW Buyer ID.
function buildFiveDayBuyerBundles(sourceOrders) {
    const groupedByCustomer = {};
    sourceOrders.forEach(order => {
        const key = order.customer_id || '__unknown__';
        if (!groupedByCustomer[key]) groupedByCustomer[key] = [];
        groupedByCustomer[key].push(order);
    });

    const buyerMeta = {};
    let buyerCounter = 0;

    Object.keys(groupedByCustomer)
        .sort((a, b) => a.localeCompare(b))
        .forEach(customerId => {
            const customerOrders = groupedByCustomer[customerId]
                .slice()
                .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

            let currentBundle = [];
            let bundleAnchorDate = null;
            let bundleIndexForCustomer = 0;

            const flushBundle = () => {
                if (!currentBundle.length) return;
                buyerCounter++;
                bundleIndexForCustomer++;
                const buyerId = `B-${String(buyerCounter).padStart(3, '0')}`;
                const stripeClass = `buyer-stripe-${(buyerCounter - 1) % 8}`;
                const fleekIds = currentBundle.map(o => o.fleek_id);
                currentBundle.forEach((order, index) => {
                    buyerMeta[order.fleek_id] = {
                        buyerId,
                        bundleSize: currentBundle.length,
                        isFirstInBundle: index === 0,
                        stripeClass: currentBundle.length > 1 ? stripeClass : 'buyer-stripe-none',
                        customerId,
                        bundleIndexForCustomer,
                        fleekIds,
                        anchorDate: bundleAnchorDate,
                    };
                });
                currentBundle = [];
                bundleAnchorDate = null;
            };

            customerOrders.forEach(order => {
                if (!bundleAnchorDate) {
                    currentBundle = [order];
                    bundleAnchorDate = order.created_at;
                    return;
                }

                // Strict 5-day grouping from the bundle anchor.
                if (diffDaysAbs(bundleAnchorDate, order.created_at) <= 5) {
                    currentBundle.push(order);
                } else {
                    flushBundle();
                    currentBundle = [order];
                    bundleAnchorDate = order.created_at;
                }
            });

            flushBundle();
        });

    return buyerMeta;
}

function sortOrdersByBundleMeta(sourceOrders, buyerMeta) {
    return sourceOrders.slice().sort((a, b) => {
        const ma = buyerMeta[a.fleek_id];
        const mb = buyerMeta[b.fleek_id];
        const buyerA = ma?.buyerId || 'B-999';
        const buyerB = mb?.buyerId || 'B-999';
        if (buyerA !== buyerB) return buyerA.localeCompare(buyerB);
        return new Date(a.created_at) - new Date(b.created_at);
    });
}

function getHoldCountdownState(createdAt, packingStatus) {
    const isHold = packingStatus === 'Hold for bundling';
    const created = getDateValue(createdAt);
    if (!isHold || !created) {
        return {
            isHold: false,
            isBreached: false,
            totalMsLeft: null,
            text: '—',
        };
    }

    const SLA_MS = 72 * 60 * 60 * 1000;
    const elapsed = Date.now() - created.getTime();
    const remaining = SLA_MS - elapsed;
    const isBreached = remaining <= 0;

    return {
        isHold: true,
        isBreached,
        totalMsLeft: Math.max(0, remaining),
        text: isBreached ? '0h 0m left' : formatCountdown(remaining),
    };
}

function formatCountdown(ms) {
    const totalMinutes = Math.max(0, Math.floor(ms / (1000 * 60)));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m left`;
}

function startHoldCountdownTicker() {
    if (holdCountdownInterval) clearInterval(holdCountdownInterval);

    holdCountdownInterval = setInterval(() => {
        document.querySelectorAll('[data-hold-countdown="true"]').forEach(el => {
            const createdAt = el.dataset.createdAt;
            const packingStatus = el.dataset.packingStatus;
            const state = getHoldCountdownState(createdAt, packingStatus);
            el.textContent = state.text;

            const row = el.closest('tr');
            const slaBadge = row?.querySelector('[data-sla-badge="true"]');
            const slaCell = row?.querySelector('[data-sla-cell="true"]');

            if (row) row.classList.toggle('sla-breach', state.isBreached);
            if (row) row.classList.toggle('sla-breach-pulse', state.isBreached);
            if (slaBadge) slaBadge.classList.toggle('hidden', !state.isBreached);
            if (slaCell) slaCell.classList.toggle('text-red-700', state.isBreached);
            if (slaCell) slaCell.classList.toggle('font-bold', state.isBreached);
        });
    }, 60000);
}

function renderTable() {
    const container = $('tableContainer');
    if (!container) return;

    // Build 5-day bundle map from the currently visible orders dataset.
    bundleBuyerMeta = buildFiveDayBuyerBundles(filteredOrders);
    const orderedRows = sortOrdersByBundleMeta(filteredOrders, bundleBuyerMeta);

    const fc = $('filterCount');
    if (fc) fc.textContent = orderedRows.length;

    container.innerHTML = `
        <div class="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <div class="overflow-x-auto">
                <table class="w-full text-xs">
                    <thead>
                        <tr class="bg-[#F9FAFB] border-b border-gray-200">
                            <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Buyer ID</th>
                            <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Created</th>
                            <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Fleek ID</th>
                            <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Order Status</th>
                            <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Item</th>
                            <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Category</th>
                            <th class="text-center px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Qty</th>
                            <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Vendor</th>
                            <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Zone</th>
                            <th class="text-center px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Bargain</th>
                            <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px] min-w-[310px]">Packing Status / Lead Time</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${orderedRows.length === 0
                            ? '<tr><td colspan="11" class="px-4 py-8 text-center text-gray-400 text-sm">No orders in this zone</td></tr>'
                            : orderedRows.map(order => renderBundleRow(order, order.fleek_id === searchData?.searched_fleek_id)).join('')}
                    </tbody>
                </table>
            </div>
            <div class="px-4 py-2.5 bg-[#F9FAFB] border-t border-gray-100 flex items-center justify-between text-[10px] text-gray-400">
                <span>${orderedRows.length} order${orderedRows.length !== 1 ? 's' : ''} displayed</span>
                <span>5-day bundle consolidation active</span>
            </div>
        </div>
    `;

    startHoldCountdownTicker();
}

function renderBundleRow(order, isSearched) {
    const sc = statusCfg(order.latest_status);
    const fid = esc(order.fleek_id);
    const currentStatus = order.packing_status || 'Pending';
    const statusClass = packingStatusClass(currentStatus);
    const zoneClass = order.zone_location === 'PK QC Center'
        ? 'bg-blue-50 text-blue-700 border-blue-200'
        : 'bg-purple-50 text-purple-700 border-purple-200';

    const meta = bundleBuyerMeta[order.fleek_id] || {
        buyerId: 'B-000',
        bundleSize: 1,
        isFirstInBundle: true,
        stripeClass: 'buyer-stripe-none',
    };

    const holdState = getHoldCountdownState(order.created_at, currentStatus);

    return `
        <tr class="data-row ${meta.stripeClass} ${holdState.isBreached ? 'sla-breach sla-breach-pulse' : ''} ${isSearched && !holdState.isBreached ? 'bg-blue-50/40' : ''}" data-fid="${fid}" data-buyer="${meta.buyerId}">
            <td class="px-3 py-2.5 align-top">
                <span class="buyer-tag inline-block bg-gray-100 text-gray-800 text-[11px] font-bold px-2 py-0.5 rounded-md border border-gray-200">${meta.buyerId}</span>
                ${meta.bundleSize > 1 && meta.isFirstInBundle
                    ? `<span class="bundle-badge mt-1.5 block px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-200">📦 Bundle (${meta.bundleSize})</span>`
                    : ''}
            </td>

            <td class="px-3 py-2.5 whitespace-nowrap">
                ${isSearched ? '<span class="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 mr-1 align-middle"></span>' : ''}
                <span class="text-gray-700">${fmtDate(order.created_at)}</span>
                <p class="text-[9px] ${holdState.isBreached ? 'text-red-600 font-bold' : 'text-gray-400'} mt-0.5">${holdState.isHold ? holdState.text : '—'}</p>
            </td>

            <td class="px-3 py-2.5">
                <p class="font-mono font-semibold text-gray-800 text-[11px]">${fid}</p>
                <p class="text-[9px] text-gray-400">${esc(order.order_number)}</p>
            </td>

            <td class="px-3 py-2.5" data-sla-cell="true">
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${sc.bg} ${sc.text} border ${sc.border}">
                    <span class="w-1.5 h-1.5 rounded-full ${sc.dot}"></span>
                    ${esc(order.latest_status)}
                </span>
                <div class="mt-1.5 flex flex-col gap-1">
                    <span class="text-[10px] ${holdState.isBreached ? 'text-red-700 font-bold' : 'text-gray-500'}">
                        ${currentStatus === 'Hold for bundling' ? holdState.text : esc(currentStatus)}
                    </span>
                    <span data-sla-badge="true" class="${holdState.isBreached ? '' : 'hidden'} inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 text-[9px] font-bold border border-red-200 w-fit">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
                        SLA Breached
                    </span>
                </div>
            </td>

            <td class="px-3 py-2.5">
                <p class="text-gray-800 font-medium max-w-[140px] truncate" title="${esc(order.item_name)}">${esc(order.item_name)}</p>
            </td>

            <td class="px-3 py-2.5">
                <p class="text-gray-700">${esc(order.category)}</p>
                <p class="text-[9px] text-gray-400">${esc(order.product_type)}</p>
            </td>

            <td class="px-3 py-2.5 text-center">
                <span class="inline-flex items-center justify-center w-6 h-6 bg-gray-100 text-gray-800 font-bold rounded text-[11px]">${order.quantity_sold ?? '—'}</span>
            </td>

            <td class="px-3 py-2.5">
                <p class="text-gray-800 font-medium max-w-[100px] truncate" title="${esc(order.vendor)}">${esc(order.vendor)}</p>
                ${order.vendor_zone ? `<p class="text-[9px] text-gray-400">${esc(order.vendor_zone)}</p>` : ''}
            </td>

            <td class="px-3 py-2.5">
                <span class="inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-semibold border ${zoneClass}">${esc(order.zone_location)}</span>
            </td>

            <td class="px-3 py-2.5 text-center">
                ${order.bargain_bin_flag
                    ? '<span class="inline-flex items-center justify-center w-5 h-5 bg-amber-100 rounded-full border border-amber-200"><svg class="w-3 h-3 text-amber-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></span>'
                    : '<span class="text-gray-300">—</span>'}
            </td>

            <td class="px-3 py-2">
                <div class="flex items-center gap-2">
                    <select
                        id="status-${fid}"
                        class="status-select flex-1 px-2.5 py-1.5 border rounded-lg cursor-pointer ${statusClass}"
                        data-fid="${fid}"
                        data-hold-countdown="${holdState.isHold ? 'true' : 'false'}"
                        data-created-at="${esc(order.created_at)}"
                        data-packing-status="${esc(currentStatus)}"
                        onchange="updateSelectStyle(this)"
                    >
                        ${PACKING_STATUSES.map(s => `<option value="${s}" ${s === currentStatus ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                    <button onclick="saveStatus('${fid}')" id="btn-${fid}" class="px-2.5 py-1.5 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white text-[10px] font-semibold rounded-lg flex items-center gap-1 transition-all">
                        <svg class="w-3 h-3 ic-save" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                        <svg class="w-3 h-3 ic-load hidden spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                        Save
                    </button>
                </div>
                ${order.marking_updated_at ? `<p class="text-[9px] text-gray-400 mt-1">Updated: ${fmtDateTime(order.marking_updated_at)}</p>` : ''}
            </td>
        </tr>
    `;
}