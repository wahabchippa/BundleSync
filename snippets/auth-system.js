// ============================================================
// BUNDLESYNC AUTHENTICATION SYSTEM - JavaScript
// Add this to your <script> section, BEFORE other app logic
// ============================================================

// ── User Database (Mock) ──
const AUTH_USERS = [
    { id: 1, name: 'Abdul wahab', role: 'Admin', pin: '0000' },
    { id: 2, name: 'Albash akhtar', role: 'Manager', pin: '5555' },
    { id: 3, name: 'Behzad riaz', role: 'Employee', pin: '1234' },
    { id: 4, name: 'Ishtiaq ur rehman', role: 'Employee', pin: '1234' },
    { id: 5, name: 'Hamza saeed', role: 'Employee', pin: '1234' },
    { id: 6, name: 'Muhammad sohail', role: 'Employee', pin: '1234' },
    { id: 7, name: 'Faizan', role: 'Employee', pin: '1234' },
];

// ── Pending Registration Requests ──
let pendingRegistrations = [
    // Example: { name: 'New Person', requestedAt: '2026-01-20T10:00:00Z' }
];

// ── Current Session ──
let currentUser = null;

// ============================================================
// INITIALIZATION
// ============================================================

function initAuth() {
    populateUserSelect();
    checkExistingSession();
}

function populateUserSelect() {
    const select = document.getElementById('userSelect');
    if (!select) return;
    
    select.innerHTML = '<option value="" disabled selected>Select your name...</option>';
    AUTH_USERS.forEach(user => {
        const opt = document.createElement('option');
        opt.value = user.id;
        opt.textContent = user.name;
        select.appendChild(opt);
    });
}

function checkExistingSession() {
    const saved = sessionStorage.getItem('bundlesync_user');
    if (saved) {
        try {
            const user = JSON.parse(saved);
            if (AUTH_USERS.find(u => u.id === user.id)) {
                loginSuccess(user);
            }
        } catch (e) {
            sessionStorage.removeItem('bundlesync_user');
        }
    }
}

// ============================================================
// LOGIN HANDLING
// ============================================================

function handleLogin(event) {
    event.preventDefault();
    
    const select = document.getElementById('userSelect');
    const userId = parseInt(select.value);
    const enteredPin = getPinValue();
    
    if (!userId || enteredPin.length !== 4) return;
    
    const user = AUTH_USERS.find(u => u.id === userId);
    if (!user) return;
    
    // Show loading
    setLoginLoading(true);
    hideError();
    
    // Simulate auth delay
    setTimeout(() => {
        if (user.pin === enteredPin) {
            loginSuccess(user);
        } else {
            showPinError();
            setLoginLoading(false);
        }
    }, 600);
}

function loginSuccess(user) {
    currentUser = user;
    sessionStorage.setItem('bundlesync_user', JSON.stringify(user));
    
    // Fade out auth overlay
    const overlay = document.getElementById('authOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
    
    // Update nav with user badge
    renderUserBadge();
    
    // Show admin tab if admin
    toggleAdminTab();
    
    // Show toast
    showAuthToast(`Welcome back, ${user.name.split(' ')[0]}!`);
    
    console.log(`[Auth] Logged in as ${user.name} (${user.role})`);
}

function logout() {
    currentUser = null;
    sessionStorage.removeItem('bundlesync_user');
    
    // Reset form
    clearPinInputs();
    document.getElementById('userSelect').value = '';
    
    // Show auth overlay
    const overlay = document.getElementById('authOverlay');
    if (overlay) {
        overlay.classList.remove('hidden');
    }
    
    // Remove user badge
    const badge = document.getElementById('userBadge');
    if (badge) badge.remove();
    
    // Hide admin tab
    toggleAdminTab();
    
    showAuthToast('Signed out successfully');
}

// ============================================================
// PIN INPUT HANDLING
// ============================================================

function handlePinInput(current, nextId) {
    const val = current.value.replace(/\D/g, '');
    current.value = val;
    
    if (val && nextId) {
        document.getElementById(nextId)?.focus();
    }
    
    // Auto-submit if all 4 digits entered
    if (getPinValue().length === 4) {
        document.getElementById('loginForm')?.requestSubmit();
    }
}

function handlePinKeydown(event, prevId, nextId) {
    if (event.key === 'Backspace' && !event.target.value && prevId) {
        document.getElementById(prevId)?.focus();
    }
    if (event.key === 'ArrowLeft' && prevId) {
        document.getElementById(prevId)?.focus();
    }
    if (event.key === 'ArrowRight' && nextId) {
        document.getElementById(nextId)?.focus();
    }
}

function getPinValue() {
    return ['pin1', 'pin2', 'pin3', 'pin4']
        .map(id => document.getElementById(id)?.value || '')
        .join('');
}

function clearPinInputs() {
    ['pin1', 'pin2', 'pin3', 'pin4'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.value = '';
            el.classList.remove('error');
        }
    });
}

function showPinError() {
    ['pin1', 'pin2', 'pin3', 'pin4'].forEach(id => {
        document.getElementById(id)?.classList.add('error');
    });
    document.getElementById('pinError')?.classList.remove('hidden');
    
    setTimeout(() => {
        clearPinInputs();
        document.getElementById('pin1')?.focus();
    }, 600);
}

function hideError() {
    document.getElementById('pinError')?.classList.add('hidden');
    ['pin1', 'pin2', 'pin3', 'pin4'].forEach(id => {
        document.getElementById(id)?.classList.remove('error');
    });
}

function setLoginLoading(loading) {
    const btn = document.getElementById('loginBtn');
    const text = document.getElementById('loginBtnText');
    const spinner = document.getElementById('loginBtnSpinner');
    
    if (btn) btn.disabled = loading;
    if (text) text.textContent = loading ? 'Signing in...' : 'Sign In';
    if (spinner) spinner.classList.toggle('hidden', !loading);
}

// ============================================================
// REGISTRATION HANDLING
// ============================================================

function toggleRegisterForm() {
    const loginCard = document.getElementById('loginCard');
    const registerCard = document.getElementById('registerCard');
    
    if (loginCard && registerCard) {
        loginCard.classList.toggle('hidden');
        registerCard.classList.toggle('hidden');
    }
    
    // Reset forms
    document.getElementById('loginForm')?.reset();
    document.getElementById('registerForm')?.reset();
    document.getElementById('registerSuccess')?.classList.add('hidden');
    clearPinInputs();
}

function handleRegister(event) {
    event.preventDefault();
    
    const nameInput = document.getElementById('regName');
    const name = nameInput?.value?.trim();
    
    if (!name || name.length < 3) return;
    
    // Check if already exists
    if (AUTH_USERS.some(u => u.name.toLowerCase() === name.toLowerCase())) {
        showAuthToast('This name already exists in the system', 'error');
        return;
    }
    
    if (pendingRegistrations.some(r => r.name.toLowerCase() === name.toLowerCase())) {
        showAuthToast('Request already pending for this name', 'error');
        return;
    }
    
    // Show loading
    const btn = document.getElementById('registerBtn');
    const text = document.getElementById('registerBtnText');
    const spinner = document.getElementById('registerBtnSpinner');
    
    if (btn) btn.disabled = true;
    if (text) text.textContent = 'Submitting...';
    if (spinner) spinner.classList.remove('hidden');
    
    setTimeout(() => {
        // Add to pending
        pendingRegistrations.push({
            name: name,
            requestedAt: new Date().toISOString()
        });
        
        // Reset button
        if (btn) btn.disabled = false;
        if (text) text.textContent = 'Submit Request';
        if (spinner) spinner.classList.add('hidden');
        
        // Show success
        document.getElementById('registerSuccess')?.classList.remove('hidden');
        nameInput.value = '';
        
        console.log(`[Auth] Registration request submitted: ${name}`);
    }, 800);
}

// ============================================================
// ADMIN FUNCTIONS (Only for Abdul wahab)
// ============================================================

function isAdmin() {
    return currentUser?.role === 'Admin';
}

function openAdminPanel() {
    if (!isAdmin()) {
        showAuthToast('Admin access required', 'error');
        return;
    }
    
    document.getElementById('adminModal')?.classList.remove('hidden');
    renderAdminPanels();
}

function closeAdminPanel() {
    document.getElementById('adminModal')?.classList.add('hidden');
    closePinReset();
}

function switchAdminTab(tab) {
    const tabRequests = document.getElementById('tabRequests');
    const tabTeam = document.getElementById('tabTeam');
    const panelRequests = document.getElementById('panelRequests');
    const panelTeam = document.getElementById('panelTeam');
    
    if (tab === 'requests') {
        tabRequests?.classList.add('active');
        tabTeam?.classList.remove('active');
        panelRequests?.classList.remove('hidden');
        panelTeam?.classList.add('hidden');
    } else {
        tabRequests?.classList.remove('active');
        tabTeam?.classList.add('active');
        panelRequests?.classList.add('hidden');
        panelTeam?.classList.remove('hidden');
    }
}

function renderAdminPanels() {
    renderPendingRequests();
    renderTeamList();
}

function renderPendingRequests() {
    const list = document.getElementById('requestsList');
    const empty = document.getElementById('noRequests');
    const badge = document.getElementById('pendingBadge');
    
    if (badge) {
        badge.textContent = pendingRegistrations.length;
        badge.dataset.count = pendingRegistrations.length;
    }
    
    if (!list || !empty) return;
    
    if (pendingRegistrations.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }
    
    empty.classList.add('hidden');
    list.innerHTML = pendingRegistrations.map((req, idx) => `
        <div class="admin-list-item">
            <div class="admin-user-info">
                <div class="admin-user-avatar pending">${req.name.charAt(0).toUpperCase()}</div>
                <div>
                    <div class="admin-user-name">${escapeHtml(req.name)}</div>
                    <div class="admin-user-role">Requested ${formatTimeAgo(req.requestedAt)}</div>
                </div>
            </div>
            <div class="admin-user-actions">
                <button class="admin-btn-approve" onclick="approveRegistration(${idx})">Approve</button>
                <button class="admin-btn-reject" onclick="rejectRegistration(${idx})">Reject</button>
            </div>
        </div>
    `).join('');
}

function renderTeamList() {
    const list = document.getElementById('teamList');
    if (!list) return;
    
    list.innerHTML = AUTH_USERS.map(user => {
        const avatarClass = user.role.toLowerCase();
        const isCurrentUser = user.id === currentUser?.id;
        
        return `
        <div class="admin-list-item">
            <div class="admin-user-info">
                <div class="admin-user-avatar ${avatarClass}">${user.name.charAt(0).toUpperCase()}</div>
                <div>
                    <div class="admin-user-name">${escapeHtml(user.name)} ${isCurrentUser ? '<span style="color:#9CA3AF">(You)</span>' : ''}</div>
                    <div class="admin-user-role">${user.role} · PIN: ••••</div>
                </div>
            </div>
            <div class="admin-user-actions">
                <button class="admin-btn-reset" onclick="openPinReset('${escapeHtml(user.name)}')" ${user.role === 'Admin' && !isCurrentUser ? 'disabled' : ''}>
                    Reset PIN
                </button>
            </div>
        </div>
    `}).join('');
}

function approveRegistration(index) {
    if (!isAdmin()) return;
    
    const req = pendingRegistrations[index];
    if (!req) return;
    
    // Add new user with default Employee role and PIN
    const newUser = {
        id: AUTH_USERS.length + 1,
        name: req.name,
        role: 'Employee',
        pin: '1234'
    };
    AUTH_USERS.push(newUser);
    
    // Remove from pending
    pendingRegistrations.splice(index, 1);
    
    // Re-render
    renderAdminPanels();
    populateUserSelect();
    
    showAuthToast(`${req.name} approved as Employee (PIN: 1234)`);
    console.log(`[Admin] Approved: ${req.name}`);
}

function rejectRegistration(index) {
    if (!isAdmin()) return;
    
    const req = pendingRegistrations[index];
    if (!req) return;
    
    pendingRegistrations.splice(index, 1);
    renderAdminPanels();
    
    showAuthToast(`Request from ${req.name} rejected`);
    console.log(`[Admin] Rejected: ${req.name}`);
}

// ── PIN Reset ──
let pinResetTarget = null;

function openPinReset(userName) {
    if (!isAdmin()) return;
    
    pinResetTarget = userName;
    document.getElementById('resetUserName').textContent = userName;
    document.getElementById('pinResetModal')?.classList.remove('hidden');
    
    // Clear inputs
    ['newPin1', 'newPin2', 'newPin3', 'newPin4'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('newPin1')?.focus();
}

function closePinReset() {
    pinResetTarget = null;
    document.getElementById('pinResetModal')?.classList.add('hidden');
}

function confirmPinReset() {
    if (!isAdmin() || !pinResetTarget) return;
    
    const newPin = ['newPin1', 'newPin2', 'newPin3', 'newPin4']
        .map(id => document.getElementById(id)?.value || '')
        .join('');
    
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
        showAuthToast('Please enter a valid 4-digit PIN', 'error');
        return;
    }
    
    resetUserPin(pinResetTarget, newPin);
    closePinReset();
}

function resetUserPin(userName, newPin) {
    if (!isAdmin()) {
        console.error('[Auth] Only admin can reset PINs');
        return false;
    }
    
    const user = AUTH_USERS.find(u => u.name === userName);
    if (!user) {
        console.error(`[Auth] User not found: ${userName}`);
        return false;
    }
    
    user.pin = newPin;
    renderAdminPanels();
    
    showAuthToast(`PIN reset for ${userName}`);
    console.log(`[Admin] PIN reset for: ${userName}`);
    return true;
}

// ============================================================
// UI HELPERS
// ============================================================

function renderUserBadge() {
    if (!currentUser) return;
    
    // Remove existing
    document.getElementById('userBadge')?.remove();
    
    const badge = document.createElement('div');
    badge.id = 'userBadge';
    badge.className = 'user-badge no-print';
    badge.innerHTML = `
        <div class="user-badge-avatar">${currentUser.name.charAt(0).toUpperCase()}</div>
        <div>
            <div class="user-badge-name">${currentUser.name.split(' ')[0]}</div>
            <div class="user-badge-role">${currentUser.role}</div>
        </div>
        <button class="user-badge-logout" onclick="logout()" title="Sign Out">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
            </svg>
        </button>
    `;
    
    // Insert into nav
    const nav = document.querySelector('nav .flex.items-center.gap-4');
    if (nav) {
        nav.prepend(badge);
    }
}

function toggleAdminTab() {
    // This will be connected to your main nav tabs
    // Show/hide admin settings option based on role
    const adminBtn = document.getElementById('adminSettingsBtn');
    if (adminBtn) {
        adminBtn.style.display = isAdmin() ? 'flex' : 'none';
    }
}

function showAuthToast(message, type = 'success') {
    // Reuse existing toast function if available, or create inline
    if (typeof toast === 'function') {
        toast(message, type);
    } else {
        const container = document.getElementById('toast');
        if (!container) return;
        
        const t = document.createElement('div');
        const bg = type === 'error' ? 'bg-red-600' : 'bg-gray-900';
        t.className = `${bg} text-white px-4 py-2 rounded-xl text-xs font-medium shadow-lg animate-in`;
        t.textContent = message;
        container.appendChild(t);
        setTimeout(() => { 
            t.style.opacity = '0'; 
            t.style.transition = 'opacity 0.2s'; 
            setTimeout(() => t.remove(), 200); 
        }, 3000);
    }
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTimeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
}

// ============================================================
// AUTO-INIT ON DOM READY
// ============================================================
document.addEventListener('DOMContentLoaded', initAuth);
