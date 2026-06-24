# BundleSync Authentication System — Integration Guide

## Quick Integration Steps

### Step 1: Add CSS
Copy contents of `auth-system.css` into your `<style>` section.

### Step 2: Add HTML
Copy contents of `auth-system.html` and paste right after `<body>` tag, BEFORE your `<nav>`.

### Step 3: Add JavaScript
Copy contents of `auth-system.js` and paste at the START of your `<script>` section, BEFORE other app logic.

### Step 4: Add Favicon to `<head>`
```html
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23111827' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'/%3E%3C/svg%3E">
```

### Step 5: Add Admin Settings Button to Nav
Add this button inside your nav, visible only to admin:
```html
<button id="adminSettingsBtn" onclick="openAdminPanel()" style="display:none" class="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-[11px] font-medium flex items-center gap-1.5">
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
    </svg>
    Admin
</button>
```

---

## User Accounts

| Name | Role | Default PIN | Rights |
|------|------|-------------|--------|
| Abdul wahab | Admin | 0000 | Full access, approve users, reset PINs |
| Albash akhtar | Manager | 5555 | View all dashboards, carts, analytics |
| Behzad riaz | Employee | 1234 | Standard execution rights |
| Ishtiaq ur rehman | Employee | 1234 | Standard execution rights |
| Hamza saeed | Employee | 1234 | Standard execution rights |
| Muhammad sohail | Employee | 1234 | Standard execution rights |
| Faizan | Employee | 1234 | Standard execution rights |

---

## Available Functions

```javascript
// Check if user is logged in
if (currentUser) { ... }

// Check if user is admin
if (isAdmin()) { ... }

// Get current user info
console.log(currentUser.name, currentUser.role);

// Logout programmatically
logout();

// Admin only: Approve a pending registration
approveRegistration(index);

// Admin only: Reset a user's PIN
resetUserPin('Behzad riaz', '9999');

// Open admin panel (admin only)
openAdminPanel();
```

---

## Flow Diagram

```
┌─────────────────┐
│  App Loads      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│ Check Session   │────▶│ Session Found?   │
└─────────────────┘     └────────┬─────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
            ┌──────────────┐          ┌──────────────┐
            │ Show Login   │          │ Auto Login   │
            │ Overlay      │          │ + Hide Modal │
            └──────┬───────┘          └──────────────┘
                   │
                   ▼
            ┌──────────────┐
            │ User Enters  │
            │ Name + PIN   │
            └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │ Validate PIN │
            └──────┬───────┘
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
   ┌──────────┐        ┌──────────┐
   │ Success  │        │ Error    │
   │ Hide     │        │ Shake    │
   │ Overlay  │        │ + Retry  │
   └──────────┘        └──────────┘
```
