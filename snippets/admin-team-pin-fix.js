function renderTeamPanel() {
    const el = document.getElementById('adPanelTeam');
    if (!el) return;

    el.innerHTML = AUTH_USERS.map(user => {
        const avatarClass = user.role === 'Admin' ? 'av-admin' : user.role === 'Manager' ? 'av-manager' : 'av-employee';
        const isMe = user.id === currentUser?.id;

        return `
            <div class="member-row">
                <div class="flex items-center gap-3">
                    <div class="member-avatar ${avatarClass}">${user.name.charAt(0).toUpperCase()}</div>
                    <div>
                        <div class="text-[13px] font-semibold text-gray-900">${esc(user.name)} ${isMe ? '<span class="text-gray-400">(You)</span>' : ''}</div>
                        <div class="text-[11px] text-gray-500">${user.role} · PIN: ${user.pin}</div>
                    </div>
                </div>
                <button onclick="openPinReset('${esc(user.name)}')" class="px-3 py-1.5 bg-white border border-gray-200 text-gray-600 text-[11px] font-medium rounded-lg cursor-pointer hover:bg-gray-50">Reset PIN</button>
            </div>`;
    }).join('');
}