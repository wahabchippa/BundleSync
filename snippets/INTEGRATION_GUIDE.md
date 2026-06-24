# Integration Guide - Code Snippets

## Quick Reference: What Goes Where

### Step 1: Add Constants (Top of `<script>`)
```javascript
// Add after existing constants
const VISIBLE_STATUSES = ['CREATED', 'ACCEPTED', 'PICKUP_READY', 'COURIER', 'QC_HOLD', 'QC_PENDING', 'QC_APPROVED'];
let buyerIdMap = {};
let buyerIdCounter = 0;
```

### Step 2: Add New Functions
Add these new functions anywhere in your `<script>`:
- `getBuyerId(customerId)` - Maps customer_id to B-001, B-002, etc.
- `resetBuyerIdMap()` - Clears mapping for new search
- `handleLocalSearch()` - Handles tab-specific filtering

### Step 3: Replace Existing Functions
Replace these functions completely:
- `applyFilter()` - Now includes status filtering + override rule
- `search()` - Now supports Buyer ID search (B-XXX)
- `renderTable()` - Adds Buyer ID column + local search bar
- `row()` - Adds Buyer ID cell + Bundle badge + Override indicator
- `statusCfg()` - Extended with new status types

### Step 4: Add CSS
Add the CSS from `styles.css` to your `<style>` section.

---

## Feature Summary

### 1️⃣ Buyer ID Column
| Original customer_id | Mapped Buyer ID |
|---------------------|-----------------|
| CUST-PK-55421 | B-001 |
| CUST-AE-88214 | B-002 |
| CUST-PK-12345 | B-003 |

### 2️⃣ Visual Grouping
- Same-buyer orders have colored left border
- First row shows `📦 Bundle (X)` badge
- 8 distinct colors for different buyers

### 3️⃣ Status Filter
**Visible by Default:**
- CREATED, ACCEPTED, PICKUP_READY
- COURIER, QC_HOLD, QC_PENDING, QC_APPROVED

**Hidden Unless Marked:**
- HANDED_OVER_TO_LOGISTICS_PARTNER
- FREIGHT, DELIVERED, etc.

**Override Indicator:**
- Shows `⚡ Override` badge on rows kept visible due to marking

### 4️⃣ Multi-Search
Search accepts:
- Fleek ID: `FLK-2026-001`
- Order Number: `ORD-88001`
- Buyer ID: `B-001`

### 5️⃣ Local Search Bars
Each tab (All/PK QC/PK Zone) has its own filter input for:
- Buyer ID
- Fleek ID
- Item name
- Order number

---

## Testing Checklist

- [ ] Search by Fleek ID works
- [ ] Search by Buyer ID (B-001) works
- [ ] Same-buyer orders grouped together
- [ ] Bundle badge shows correct count
- [ ] Only visible statuses shown
- [ ] Marked orders with hidden status show Override badge
- [ ] Tab filtering works
- [ ] Local search within tab works
- [ ] Packing status dropdown saves correctly
