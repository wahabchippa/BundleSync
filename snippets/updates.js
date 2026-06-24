// ============================================================
// SNIPPET 1: Add these new constants and state variables
// (Add at the top with other constants)
// ============================================================

const VISIBLE_STATUSES = [
    'CREATED',
    'ACCEPTED',
    'PICKUP_READY',
    'COURIER',
    'QC_HOLD',
    'QC_PENDING',
    'QC_APPROVED'
];

// Buyer ID mapping (customer_id -> B-001, B-002, etc.)
let buyerIdMap = {};
let buyerIdCounter = 0;


// ============================================================
// SNIPPET 2: Replace the existing applyFilter() function
// ============================================================

function applyFilter() {
    // Step 1: Apply zone filter
    let filtered;
    if (currentTab === 'all') {
        filtered = [...orders];
    } else if (currentTab === 'pk_qc_center') {
        filtered = orders.filter(o => o.zone_location === 'PK QC Center');
    } else if (currentTab === 'pk_zone') {
        filtered = orders.filter(o => o.zone_location === 'PK Zone');
    }

    // Step 2: Apply status filter with override rule
    filtered = filtered.filter(o => {
        const status = (o.latest_status || '').toUpperCase().replace(/\s+/g, '_');
        const isVisibleStatus = VISIBLE_STATUSES.includes(status);
        const hasMarking = o.packing_status && o.packing_status !== 'Pending';
        
        // Show if: visible status OR has a marking (override rule)
        return isVisibleStatus || hasMarking;
    });

    // Step 3: Apply local search filter (if any)
    const localSearchInput = document.getElementById('localSearch');
    const localQuery = localSearchInput ? localSearchInput.value.trim().toLowerCase() : '';
    
    if (localQuery) {
        filtered = filtered.filter(o => {
            const buyerId = getBuyerId(o.customer_id).toLowerCase();
            const fleekId = (o.fleek_id || '').toLowerCase();
            const orderNum = (o.order_number || '').toLowerCase();
            const itemName = (o.item_name || '').toLowerCase();
            const customerId = (o.customer_id || '').toLowerCase();
            
            return buyerId.includes(localQuery) ||
                   fleekId.includes(localQuery) ||
                   orderNum.includes(localQuery) ||
                   itemName.includes(localQuery) ||
                   customerId.includes(localQuery);
        });
    }

    // Step 4: Sort by Buyer ID to group same-buyer orders together
    filtered.sort((a, b) => {
        const buyerA = getBuyerId(a.customer_id);
        const buyerB = getBuyerId(b.customer_id);
        if (buyerA !== buyerB) return buyerA.localeCompare(buyerB);
        return new Date(a.created_at) - new Date(b.created_at);
    });

    filteredOrders = filtered;
}


// ============================================================
// SNIPPET 3: Add this new function for Buyer ID mapping
// ============================================================

function getBuyerId(customerId) {
    if (!customerId) return 'B-000';
    
    if (!buyerIdMap[customerId]) {
        buyerIdCounter++;
        buyerIdMap[customerId] = `B-${String(buyerIdCounter).padStart(3, '0')}`;
    }
    return buyerIdMap[customerId];
}

function resetBuyerIdMap() {
    buyerIdMap = {};
    buyerIdCounter = 0;
}


// ============================================================
// SNIPPET 4: Replace the search() function
// ============================================================

async function search(query) {
    showLoading();
    
    // Reset buyer ID mapping for fresh search
    resetBuyerIdMap();
    
    try {
        // Check if searching by Buyer ID (B-XXX format)
        const buyerIdMatch = query.match(/^B-(\d{3})$/i);
        
        let searchQuery = query;
        
        // If searching by Buyer ID, we need to find the original customer_id
        // This works for subsequent searches within same session
        if (buyerIdMatch) {
            const targetBuyerId = query.toUpperCase();
            const foundCustomerId = Object.keys(buyerIdMap).find(
                cid => buyerIdMap[cid] === targetBuyerId
            );
            if (foundCustomerId) {
                // Search by any fleek_id from that customer
                const existingOrder = orders.find(o => o.customer_id === foundCustomerId);
                if (existingOrder) {
                    searchQuery = existingOrder.fleek_id;
                }
            }
        }
        
        const res = await fetch(`${API}/search?fleek_id=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Search failed');
        
        searchData = data;
        orders = data.orders || [];
        currentTab = 'all';
        
        // Build Buyer ID map from results
        orders.forEach(o => getBuyerId(o.customer_id));
        
        applyFilter();
        render(data);
    } catch (e) {
        showError('Search Failed', e.message);
    }
}


// ============================================================
// SNIPPET 5: Replace the renderTable() function
// ============================================================

function renderTable() {
    const c = $('tableContainer'); 
    if (!c) return;
    
    const fc = $('filterCount'); 
    if (fc) fc.textContent = filteredOrders.length;

    // Calculate buyer groups for visual grouping
    const buyerGroups = {};
    filteredOrders.forEach(o => {
        const bid = getBuyerId(o.customer_id);
        if (!buyerGroups[bid]) buyerGroups[bid] = [];
        buyerGroups[bid].push(o.fleek_id);
    });

    // Assign colors for buyers with multiple orders
    const buyerColors = {};
    const colorPalette = [
        'border-l-blue-400',
        'border-l-purple-400', 
        'border-l-emerald-400',
        'border-l-amber-400',
        'border-l-rose-400',
        'border-l-cyan-400',
        'border-l-indigo-400',
        'border-l-orange-400'
    ];
    let colorIndex = 0;
    Object.keys(buyerGroups).forEach(bid => {
        if (buyerGroups[bid].length > 1) {
            buyerColors[bid] = colorPalette[colorIndex % colorPalette.length];
            colorIndex++;
        }
    });

    c.innerHTML = `
    <div class="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <!-- Local Search Bar -->
        <div class="px-4 py-3 bg-gray-50 border-b border-gray-100">
            <div class="relative max-w-xs">
                <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
                <input 
                    type="text" 
                    id="localSearch" 
                    class="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-xs placeholder-gray-400 focus:outline-none focus:border-gray-400"
                    placeholder="Filter by Buyer ID, Fleek ID, item..."
                    oninput="handleLocalSearch()"
                />
            </div>
        </div>
        
        <div class="overflow-x-auto">
            <table class="w-full text-xs">
                <thead>
                    <tr class="bg-[#F9FAFB] border-b border-gray-200">
                        <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Buyer ID</th>
                        <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Created</th>
                        <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Fleek ID</th>
                        <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Status</th>
                        <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Item</th>
                        <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Category</th>
                        <th class="text-center px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Qty</th>
                        <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Vendor</th>
                        <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Zone</th>
                        <th class="text-center px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px]">Bargain</th>
                        <th class="text-left px-3 py-2.5 font-semibold text-gray-500 uppercase text-[9px] min-w-[280px]">Packing Status</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                    ${filteredOrders.length === 0 
                        ? `<tr><td colspan="11" class="px-4 py-8 text-center text-gray-400 text-sm">No orders match the current filters</td></tr>`
                        : filteredOrders.map((o, idx) => {
                            const buyerId = getBuyerId(o.customer_id);
                            const groupSize = buyerGroups[buyerId].length;
                            const isFirstInGroup = buyerGroups[buyerId][0] === o.fleek_id;
                            const borderColor = buyerColors[buyerId] || '';
                            return row(o, o.fleek_id === searchData?.searched_fleek_id, buyerId, groupSize, isFirstInGroup, borderColor);
                        }).join('')
                    }
                </tbody>
            </table>
        </div>
        <div class="px-4 py-2.5 bg-[#F9FAFB] border-t border-gray-100 flex justify-between text-[10px] text-gray-400">
            <span>${filteredOrders.length} order${filteredOrders.length!==1?'s':''} displayed</span>
            <span>Visible statuses: ${VISIBLE_STATUSES.length} types + marked orders</span>
        </div>
    </div>`;
}


// ============================================================
// SNIPPET 6: Replace the row() function
// ============================================================

function row(o, isSearched, buyerId, groupSize, isFirstInGroup, borderColor) {
    const sc = statusCfg(o.latest_status);
    const fid = esc(o.fleek_id);
    const ps = o.packing_status || 'Pending';
    const psc = packingStatusClass(ps);
    const zc = o.zone_location === 'PK QC Center' 
        ? 'bg-blue-50 text-blue-700 border-blue-200' 
        : 'bg-purple-50 text-purple-700 border-purple-200';
    
    // Check if order is visible due to override rule
    const status = (o.latest_status || '').toUpperCase().replace(/\s+/g, '_');
    const isOverride = !VISIBLE_STATUSES.includes(status) && ps !== 'Pending';
    
    // Border styling for grouped buyers
    const groupBorder = borderColor ? `border-l-4 ${borderColor}` : 'border-l-4 border-l-transparent';
    
    return `
    <tr class="data-row ${isSearched ? 'bg-blue-50/40' : ''} ${groupBorder} ${isOverride ? 'bg-amber-50/30' : ''}" data-fid="${fid}" data-buyer="${buyerId}">
        <!-- Buyer ID Column -->
        <td class="px-3 py-2.5">
            <div class="flex flex-col items-start gap-1">
                <span class="font-mono font-bold text-[11px] text-gray-800 bg-gray-100 px-2 py-0.5 rounded">${buyerId}</span>
                ${groupSize > 1 && isFirstInGroup ? `
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-[9px] font-semibold rounded border border-indigo-200">
                        📦 Bundle (${groupSize})
                    </span>
                ` : ''}
                ${isOverride ? `
                    <span class="inline-flex items-center px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-medium rounded" title="Kept visible due to marking">
                        ⚡ Override
                    </span>
                ` : ''}
            </div>
        </td>
        
        <!-- Created At -->
        <td class="px-3 py-2.5 whitespace-nowrap">
            ${isSearched ? '<span class="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 mr-1"></span>' : ''}
            <span class="text-gray-700">${fmtDate(o.created_at)}</span>
        </td>
        
        <!-- Fleek ID -->
        <td class="px-3 py-2.5">
            <p class="font-mono font-semibold text-gray-800 text-[11px]">${fid}</p>
            <p class="text-[9px] text-gray-400">${esc(o.order_number)}</p>
        </td>
        
        <!-- Order Status -->
        <td class="px-3 py-2.5">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${sc.bg} ${sc.text} border ${sc.border}">
                <span class="w-1.5 h-1.5 rounded-full ${sc.dot}"></span>
                ${esc(o.latest_status)}
            </span>
        </td>
        
        <!-- Item -->
        <td class="px-3 py-2.5">
            <p class="text-gray-800 font-medium max-w-[140px] truncate" title="${esc(o.item_name)}">${esc(o.item_name)}</p>
        </td>
        
        <!-- Category -->
        <td class="px-3 py-2.5">
            <p class="text-gray-700">${esc(o.category)}</p>
            <p class="text-[9px] text-gray-400">${esc(o.product_type)}</p>
        </td>
        
        <!-- Qty -->
        <td class="px-3 py-2.5 text-center">
            <span class="inline-flex items-center justify-center w-6 h-6 bg-gray-100 text-gray-800 font-bold rounded text-[11px]">${o.quantity_sold ?? '—'}</span>
        </td>
        
        <!-- Vendor -->
        <td class="px-3 py-2.5">
            <p class="text-gray-800 font-medium max-w-[100px] truncate">${esc(o.vendor)}</p>
        </td>
        
        <!-- Zone -->
        <td class="px-3 py-2.5">
            <span class="inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-semibold border ${zc}">${esc(o.zone_location)}</span>
        </td>
        
        <!-- Bargain -->
        <td class="px-3 py-2.5 text-center">
            ${o.bargain_bin_flag 
                ? '<span class="inline-flex items-center justify-center w-5 h-5 bg-amber-100 rounded-full border border-amber-200"><svg class="w-3 h-3 text-amber-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></span>' 
                : '<span class="text-gray-300">—</span>'}
        </td>
        
        <!-- Packing Status Dropdown -->
        <td class="px-3 py-2">
            <div class="flex items-center gap-2">
                <select 
                    id="status-${fid}" 
                    class="status-select flex-1 px-2.5 py-1.5 border rounded-lg text-[11px] font-medium cursor-pointer ${psc}" 
                    data-fid="${fid}" 
                    onchange="updateSelectStyle(this)"
                >
                    ${PACKING_STATUSES.map(s => `<option value="${s}" ${s === ps ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
                <button 
                    onclick="saveStatus('${fid}')" 
                    id="btn-${fid}" 
                    class="px-2.5 py-1.5 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 text-white text-[10px] font-semibold rounded-lg flex items-center gap-1"
                >
                    <svg class="w-3 h-3 ic-save" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                    </svg>
                    <svg class="w-3 h-3 ic-load hidden spin" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Save
                </button>
            </div>
            ${o.marking_updated_at ? `<p class="text-[9px] text-gray-400 mt-1">Updated: ${fmtDateTime(o.marking_updated_at)}</p>` : ''}
        </td>
    </tr>`;
}


// ============================================================
// SNIPPET 7: Add this new function for local search handling
// ============================================================

function handleLocalSearch() {
    applyFilter();
    renderTable();
    
    // Restore the search input value after re-render
    const localSearchInput = document.getElementById('localSearch');
    if (localSearchInput && localSearchInput !== document.activeElement) {
        // Re-focus if it was focused before
    }
}

// Debounced version for better performance
let localSearchTimeout;
function handleLocalSearchDebounced() {
    clearTimeout(localSearchTimeout);
    localSearchTimeout = setTimeout(() => {
        applyFilter();
        
        // Re-render table body only (preserve search input)
        const tbody = document.querySelector('#tableContainer tbody');
        if (tbody && filteredOrders) {
            // Calculate groups again
            const buyerGroups = {};
            filteredOrders.forEach(o => {
                const bid = getBuyerId(o.customer_id);
                if (!buyerGroups[bid]) buyerGroups[bid] = [];
                buyerGroups[bid].push(o.fleek_id);
            });

            const buyerColors = {};
            const colorPalette = [
                'border-l-blue-400', 'border-l-purple-400', 'border-l-emerald-400',
                'border-l-amber-400', 'border-l-rose-400', 'border-l-cyan-400'
            ];
            let colorIndex = 0;
            Object.keys(buyerGroups).forEach(bid => {
                if (buyerGroups[bid].length > 1) {
                    buyerColors[bid] = colorPalette[colorIndex % colorPalette.length];
                    colorIndex++;
                }
            });

            tbody.innerHTML = filteredOrders.length === 0 
                ? `<tr><td colspan="11" class="px-4 py-8 text-center text-gray-400 text-sm">No orders match</td></tr>`
                : filteredOrders.map((o, idx) => {
                    const buyerId = getBuyerId(o.customer_id);
                    const groupSize = buyerGroups[buyerId].length;
                    const isFirstInGroup = buyerGroups[buyerId][0] === o.fleek_id;
                    const borderColor = buyerColors[buyerId] || '';
                    return row(o, o.fleek_id === searchData?.searched_fleek_id, buyerId, groupSize, isFirstInGroup, borderColor);
                }).join('');

            // Update count
            const fc = $('filterCount');
            if (fc) fc.textContent = filteredOrders.length;
        }
    }, 200);
}


// ============================================================
// SNIPPET 8: Update the render() function's stats section
// Add these additional stats in the summary cards
// ============================================================

// Add this inside the render() function's stat cards grid:
/*
<div class="bg-white border border-gray-100 rounded-xl px-3 py-2">
    <p class="text-[9px] font-semibold text-gray-400 uppercase">Buyers</p>
    <p class="text-lg font-bold text-gray-900">${Object.keys(buyerIdMap).length}</p>
</div>
<div class="bg-white border border-gray-100 rounded-xl px-3 py-2">
    <p class="text-[9px] font-semibold text-gray-400 uppercase">Bundles</p>
    <p class="text-lg font-bold text-indigo-600">${Object.values(buyerGroups).filter(g => g.length > 1).length}</p>
</div>
*/


// ============================================================
// SNIPPET 9: Updated statusCfg to handle new statuses
// ============================================================

const statusCfg = s => {
    const l = (s||'').toUpperCase().replace(/\s+/g, '_');
    
    if (l === 'DELIVERED' || l === 'HANDED_OVER_TO_LOGISTICS_PARTNER') 
        return {bg:'bg-emerald-50',text:'text-emerald-700',dot:'bg-emerald-500',border:'border-emerald-100'};
    if (l === 'SHIPPED' || l === 'COURIER' || l === 'FREIGHT') 
        return {bg:'bg-blue-50',text:'text-blue-700',dot:'bg-blue-500',border:'border-blue-100'};
    if (l === 'PROCESSING' || l === 'CREATED' || l === 'ACCEPTED' || l === 'PICKUP_READY') 
        return {bg:'bg-amber-50',text:'text-amber-700',dot:'bg-amber-500',border:'border-amber-100'};
    if (l === 'QC_HOLD' || l === 'QC_PENDING') 
        return {bg:'bg-orange-50',text:'text-orange-700',dot:'bg-orange-500',border:'border-orange-100'};
    if (l === 'QC_APPROVED') 
        return {bg:'bg-teal-50',text:'text-teal-700',dot:'bg-teal-500',border:'border-teal-100'};
    if (l === 'RETURNED' || l === 'CANCELLED' || l === 'CANCELED') 
        return {bg:'bg-red-50',text:'text-red-600',dot:'bg-red-500',border:'border-red-100'};
    
    return {bg:'bg-gray-50',text:'text-gray-600',dot:'bg-gray-400',border:'border-gray-200'};
};
