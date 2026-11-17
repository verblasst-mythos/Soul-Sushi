let appState = null;
let currentUser = null;
let posCart = [];
let uploadedPhotoBase64 = '';
let lastKnownResCount = 0;
let lastKnownOrderCount = 0;

const MANAGEMENT_ONLY_TABS = ['team-photos', 'admin'];

document.addEventListener('DOMContentLoaded', async () => {
    await fetchState();

    if (appState && appState.reservations) {
        lastKnownResCount = appState.reservations.length;
        lastKnownOrderCount = appState.orders.length;
    }

    populateLoginDropdown();
    setInterval(fetchState, 5000);

    const savedUserId = sessionStorage.getItem('soulSushiUserId');

    if (savedUserId && appState && sessionStorage.getItem('soulStaffToken')) {
        const found = appState.staff.find(s => String(s.id) === savedUserId);

        if (found) {
            currentUser = found;
            enterWorkspace();
        }
    }

    const pinInput = document.getElementById('staffPinInput');
    const nameInput = document.getElementById('staffNameInput');

    if (pinInput) {
        pinInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                verifyStaffPin();
            }
        });
    }

    if (nameInput) {
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('staffPinInput').focus();
            }
        });
    }
});

async function fetchState() {
    try {
        const res = await fetch('/api/state');
        const newState = await res.json();

        if (!newState || !newState.staff) {
            throw new Error((newState && newState.error) || 'Ungültige Serverantwort');
        }

        if (appState && newState.reservations) {
            if (newState.reservations.length > lastKnownResCount) {
                const latestRes = newState.reservations[0];

                showCenterAlert(
                    `Name: ${latestRes.name}\nPersonen: ${latestRes.guests} Gäste\nWann: ${fmtDate(latestRes.date)} um ${latestRes.time} Uhr\nBereich: ${latestRes.type}\nTelefon: ${latestRes.phone || 'Nicht angegeben'}\nAnmerkungen: ${latestRes.notes || 'Keine'}`
                );
            }
        }

        if (newState.reservations) {
            lastKnownResCount = newState.reservations.length;
        }

        if (appState && newState.orders) {
            if (newState.orders.length > lastKnownOrderCount) {
                const latestOrder = newState.orders[0];

                showToast(`🔥 NEUE BESTELLUNG #${latestOrder.id} (${latestOrder.table}) eingetroffen!`);
            }
        }

        if (newState.orders) {
            lastKnownOrderCount = newState.orders.length;
        }

        appState = newState;
        populateLoginDropdown();

        if (currentUser) {
            const refreshedUser = appState.staff.find(
                s => String(s.id) === String(currentUser.id)
            );

            if (refreshedUser) currentUser = refreshedUser;

            renderAllViews();
        }

    } catch (err) {
        console.error('Fehler beim Laden:', err);
    }
}

function populateLoginDropdown() {
    if (!appState) return;

    const datalist = document.getElementById('staffSuggestions');

    if (!datalist) return;

    datalist.innerHTML = appState.staff
        .map(s => `<option value="${s.name}">`)
        .join('');
}

function isManagementUser(user) {
    if (!user || !appState) return false;

    const defaultMgmt = [
        'Geschäftsführung',
        'Manager',
        'Serviceleitung'
    ];

    if (defaultMgmt.includes(user.role)) return true;

    const roleObj = appState.roles.find(r => r.name === user.role);

    return roleObj ? Boolean(roleObj.isManagement) : false;
}

async function verifyStaffPin() {
    const typedName = document.getElementById('staffNameInput').value.trim();
    const pin = document.getElementById('staffPinInput').value.trim();

    if (!typedName || !pin) {
        return showToast('❌ Name und PIN eingeben');
    }

    try {
        const res = await fetch('/api/staff/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: typedName, pin })
        });

        const data = await res.json();

        if (!res.ok) {
            return showToast('❌ ' + (data.error || 'Login fehlgeschlagen'));
        }

        currentUser = data.member;

        sessionStorage.setItem('soulSushiUserId', currentUser.id);

        document.getElementById('staffPinInput').value = '';
        document.getElementById('staffNameInput').value = '';

        await fetchState();

        const fresh = appState && appState.staff &&
            appState.staff.find(s => String(s.id) === String(currentUser.id));

        if (fresh) currentUser = fresh;

        enterWorkspace();

        showToast(`Willkommen, ${currentUser.name}!`);

    } catch (err) {
        console.error(err);
        showToast('❌ Datenbank nicht erreichbar');
    }
}

function enterWorkspace() {
    document.getElementById('staffLoginScreen').style.display = 'none';
    document.getElementById('staffWorkspace').style.display = 'flex';

    document.getElementById('loggedInUserInfo').textContent =
        `Angemeldet als: ${currentUser.name} · Rang: ${currentUser.role}`;

    const canManage = isManagementUser(currentUser);

    const clockBtn = document.getElementById('tabBtnClock');
    const photosBtn = document.getElementById('tabBtnPhotos');
    const adminBtn = document.getElementById('tabBtnAdmin');

    if (clockBtn) clockBtn.style.display = 'inline-block';
    if (photosBtn) photosBtn.style.display = canManage ? 'inline-block' : 'none';
    if (adminBtn) adminBtn.style.display = canManage ? 'inline-block' : 'none';

    document.getElementById('adminRoleBadge').textContent = currentUser.role;

    renderAllViews();

    switchWorkspaceTab('clock', clockBtn);
}

function logoutStaff() {
    fetch('/api/staff/logout', { method: 'POST' }).catch(() => {});

    currentUser = null;

    sessionStorage.removeItem('soulSushiUserId');

    document.getElementById('staffWorkspace').style.display = 'none';
    document.getElementById('staffLoginScreen').style.display = 'flex';
}

function switchWorkspaceTab(tabId, btn) {
    if (MANAGEMENT_ONLY_TABS.includes(tabId) && !isManagementUser(currentUser)) {
        return showToast('❌ Zugriff nur für die Führungsebene!');
    }

    document.querySelectorAll('.ws-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.ws-panel').forEach(p => p.classList.remove('active'));

    if (btn) btn.classList.add('active');

    const target = document.getElementById(`panel-${tabId}`);

    if (target) target.classList.add('active');
}

function switchAdminSub(subId, btn) {
    document.querySelectorAll('.admin-subtab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.admin-subpanel').forEach(p => p.classList.remove('active'));

    if (btn) btn.classList.add('active');

    const target = document.getElementById(subId);

    if (target) target.classList.add('active');
}

function closeCustomModal(id) {
    const el = document.getElementById(id);

    if (el) el.classList.remove('open');
}

function getRoleColor(roleName) {
    const r = appState.roles.find(role => role.name === roleName);

    return r ? r.color : '#c82333';
}

function getStaffRevenue(staff) {
    if (!appState || !appState.orders) {
        return { total: 0, day: 0, week: 0, month: 0 };
    }

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    let total = 0;
    let day = 0;
    let week = 0;
    let month = 0;

    appState.orders.forEach(o => {
        const isMatch =
            (o.staffId && String(o.staffId) === String(staff.id)) ||
            (o.customer && o.customer.toLowerCase() === staff.name.toLowerCase());

        if (isMatch && o.status !== 'Storniert') {
            const amount = o.total || 0;

            total += amount;

            const oDate = new Date(o.timestamp || Date.now());
            const oDateStr = oDate.toISOString().split('T')[0];

            if (oDateStr === todayStr) day += amount;

            const diffDays = (now - oDate) / (1000 * 60 * 60 * 24);

            if (diffDays <= 7) week += amount;

            if (
                oDate.getMonth() === currentMonth &&
                oDate.getFullYear() === currentYear
            ) {
                month += amount;
            }
        }
    });

    return { total, day, week, month };
}

function renderAllViews() {
    if (!appState || !currentUser) return;

    const canManage = isManagementUser(currentUser);

    if (canManage) {
        const activeCount = appState.staff.filter(s => s.onDuty).length;

        document.getElementById('kpiShopStatus').textContent =
            appState.status.isOpen ? 'GEÖFFNET' : 'GESCHLOSSEN';

        document.getElementById('kpiActiveStaff').textContent =
            `${activeCount} / ${appState.staff.length}`;

        document.getElementById('kpiWorkload').textContent =
            appState.status.workload;

        document.getElementById('kpiOpenOrders').textContent =
            appState.orders.filter(o => o.status !== 'Fertig').length;

        const myTitle = document.getElementById('personalClockTitle');
        const mySub = document.getElementById('personalClockSub');
        const myBtn = document.getElementById('personalClockBtn');

        if (currentUser.onDuty) {
            myTitle.textContent = `${currentUser.name} — Du bist EINGESTEMPELT`;
            mySub.textContent = `Aktiv im Dienst seit ${currentUser.clockIn} Uhr (${currentUser.role})`;
            myBtn.textContent = 'JETZT AUSSTEMPELN';
            myBtn.className = 'btn-red';
        } else {
            myTitle.textContent = `${currentUser.name} — Aktuell AUSGESTEMPELT`;
            mySub.textContent = `Bereit für deine Schicht als ${currentUser.role}?`;
            myBtn.textContent = 'JETZT EINSTEMPELN';
            myBtn.className = 'btn-white';
        }

        document.getElementById('clockStaffGrid').innerHTML =
            appState.staff.map(s => `
                <div class="staff-card">
                    <div>
                        <span style="font-size:10px; font-weight:700; color:${getRoleColor(s.role)}; text-transform:uppercase; letter-spacing:1.5px;">${s.role}</span>
                        <strong style="display:block; font-size:16px; margin-top:2px;">${s.name}</strong>
                        <span style="font-size:12px; color:#aaa; display:block; margin-top:4px;">
                            ${s.onDuty ? `🟢 Im Dienst seit ${s.clockIn} Uhr` : '🔴 Ausgestempelt'}
                        </span>
                    </div>
                    <button type="button" class="${s.onDuty ? 'btn-red' : 'btn-white'}" onclick="toggleStaffDuty('${s.id}')">
                        ${s.onDuty ? 'AUSSTEMPELN' : 'EINSTEMPELN'}
                    </button>
                </div>
            `).join('');

        const photoRoleSel = document.getElementById('photoStaffRole');
        const newAccRoleSel = document.getElementById('newAccRole');

        const roleOptions = appState.roles
            .map(r => `<option value="${r.name}">${r.name}</option>`)
            .join('');

        if (photoRoleSel) {
            const cur = photoRoleSel.value;
            photoRoleSel.innerHTML = roleOptions;
            if (cur) photoRoleSel.value = cur;
        }

        if (newAccRoleSel) {
            const cur2 = newAccRoleSel.value;
            newAccRoleSel.innerHTML = roleOptions;
            if (cur2) newAccRoleSel.value = cur2;
        }

        document.getElementById('teamPhotoPreviewGrid').innerHTML =
            appState.staff.map(s => `
                <div class="team-member-card">
                    <div class="team-avatar-wrap">
                        <img src="${s.avatar}" alt="${s.name}">
                        <span class="team-duty-pill">${s.onDuty ? '🟢 IM DIENST' : '⚫ FREI'}</span>
                    </div>
                    <div class="team-member-info">
                        <span class="team-role-tag" style="background:${getRoleColor(s.role)};">${s.role}</span>
                        <h4>${s.name}</h4>
                        <button type="button" class="btn-white full-width" style="margin-top:12px; padding:10px;" onclick="selectStaffForPhoto('${s.id}')">
                            BILD / RANG BEARBEITEN
                        </button>
                    </div>
                </div>
            `).join('');

        // Kundenverwaltung für Geschäftsführung
        const customerListEl = document.getElementById('adminCustomersList');

        if (customerListEl && appState.customers) {
            customerListEl.innerHTML = appState.customers.length === 0
                ? '<p style="color:#888;">Noch keine Kunden registriert.</p>'
                : appState.customers.map(c => `
                    <div class="list-item-card" style="display:flex; justify-content:space-between; align-items:center; gap:15px; margin-bottom:10px; ${c.hasHausverbot ? 'border-color: #c82333; background: rgba(200,35,51,0.05);' : ''}">
                        <div>
                            <strong>${c.username}</strong>
                            <div style="font-size:12px; color:#aaa; margin-top:3px;">Rabatt: ${c.discount || 0}%</div>
                        </div>

                        <div style="display:flex; gap:15px; align-items:center;">
                            <select onchange="updateCustomerStatus('${c.id}', this.value, ${c.isStammkunde}, ${c.hasHausverbot})" style="background:#1f1f1f; color:#fff; border:1px solid rgba(255,255,255,0.2); padding:6px; border-radius:4px;">
                                <option value="Kein" ${c.vipStatus === 'Kein' ? 'selected' : ''}>Kein VIP</option>
                                <option value="Silver VIP" ${c.vipStatus === 'Silver VIP' ? 'selected' : ''}>Silver VIP (5%)</option>
                                <option value="Gold VIP" ${c.vipStatus === 'Gold VIP' ? 'selected' : ''}>Gold VIP (10%)</option>
                                <option value="Black VIP" ${c.vipStatus === 'Black VIP' ? 'selected' : ''}>Black VIP (15%)</option>
                            </select>

                            <label style="font-size:12px; display:flex; align-items:center; gap:5px; cursor:pointer;">
                                <input type="checkbox" ${c.isStammkunde ? 'checked' : ''} onchange="updateCustomerStatus('${c.id}', '${c.vipStatus}', this.checked, ${c.hasHausverbot})">
                                Stammkunde
                            </label>

                            <label style="font-size:12px; display:flex; align-items:center; gap:5px; cursor:pointer; color: #c82333; font-weight: bold;">
                                <input type="checkbox" ${c.hasHausverbot ? 'checked' : ''} onchange="updateCustomerStatus('${c.id}', '${c.vipStatus}', ${c.isStammkunde}, this.checked)">
                                Hausverbot
                            </label>

                            <button
                                type="button"
                                class="btn-red"
                                style="padding:7px 11px; white-space:nowrap;"
                                onclick="deleteCustomer('${c.id}')">
                                Konto löschen
                            </button>
                        </div>
                    </div>
                `).join('');
        }

        // VIP Anträge Verwaltung
        const vipAppsEl = document.getElementById('adminVipAppsList');

        if (vipAppsEl && appState.vipApplications) {
            vipAppsEl.innerHTML = appState.vipApplications.length === 0
                ? '<p style="color:#888;">Keine offenen VIP-Anträge.</p>'
                : appState.vipApplications.map(app => `
                    <div class="list-item-card" style="display:flex; justify-content:space-between; align-items:center; gap:15px; margin-bottom:10px;">
                        <div>
                            <strong>${app.username}</strong> beantragt
                            <span style="color:var(--gold-role, #d4af37);">${app.tier}</span>
                            <div style="font-size:12px; color:#aaa; margin-top:3px;">
                                Handy: <code>${app.phone}</code> · Status: <strong>${app.status}</strong>
                            </div>
                        </div>

                        <div style="display:flex; gap:6px;">
                            <button type="button" class="btn-white" style="padding:6px 10px; font-size:11px; background:#2ecc71; color:#fff;" onclick="handleVipAppAction('${app.id}', 'Akzeptiert')">Akzeptieren</button>
                            <button type="button" class="btn-white" style="padding:6px 10px; font-size:11px; background:#e67e22; color:#fff;" onclick="handleVipAppAction('${app.id}', 'Warteliste')">Warteliste</button>
                            <button type="button" class="btn-red" style="padding:6px 10px; font-size:11px;" onclick="handleVipAppAction('${app.id}', 'Abgelehnt')">Ablehnen</button>
                            ${app.status === 'Abgelehnt' ? `<button type="button" class="btn-nav-outline" style="padding:6px 10px; font-size:11px;" onclick="deleteVipApp('${app.id}')">🗑️ Löschen</button>` : ''}
                        </div>
                    </div>
                `).join('');
        }

        renderAppointments();

        document.getElementById('accountsManageList').innerHTML =
            appState.staff.map(s => {
                const rev = getStaffRevenue(s);

                return `
                    <div class="list-item-card" style="flex-direction:column; align-items:flex-start; gap:10px;">
                        <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                            <div>
                                <strong>${s.name}</strong>
                                <span style="color:${getRoleColor(s.role)}; font-size:11px; font-weight:700;">[${s.role}]</span>
                                <div style="font-size:12px; color:#888; margin-top:2px;">
                                    PIN: <code>••••</code>
                                    <span style="font-size:11px;">(verschlüsselt)</span>
                                </div>
                            </div>

                            <div style="display:flex; gap:6px;">
                                <button type="button" class="btn-white" style="padding:6px 10px; font-size:11px;" onclick="promptChangePin('${s.id}', '${s.name.replace(/'/g, "\\'")}')">PIN ändern</button>
                                <button type="button" class="btn-red" style="padding:6px 10px; font-size:11px;" onclick="deleteAccount('${s.id}', '${s.name.replace(/'/g, "\\'")}')">Löschen</button>
                            </div>
                        </div>

                        <div style="width:100%; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:6px; font-size:12px; display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; text-align:center;">
                            <div><span style="color:#aaa; display:block; font-size:10px;">TAG</span><strong>${rev.day.toFixed(2)} €</strong></div>
                            <div><span style="color:#aaa; display:block; font-size:10px;">WOCHE</span><strong>${rev.week.toFixed(2)} €</strong></div>
                            <div><span style="color:#aaa; display:block; font-size:10px;">MONAT</span><strong>${rev.month.toFixed(2)} €</strong></div>
                            <div><span style="color:var(--gold-role, #d4af37); display:block; font-size:10px;">GESAMT</span><strong>${rev.total.toFixed(2)} €</strong></div>
                        </div>
                    </div>
                `;
            }).join('');

        document.getElementById('adminRolesList').innerHTML =
            appState.roles.map(r => `
                <div class="list-item-card">
                    <div>
                        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${r.color}; margin-right:8px;"></span>
                        <strong>${r.name}</strong>
                        <div style="font-size:11px; color:#aaa;">
                            ${r.isManagement ? '🛡️ Führungsebene' : '👤 Standard'}
                        </div>
                    </div>
                    <button type="button" class="btn-nav-outline" onclick="deleteRole('${r.id}')">Löschen</button>
                </div>
            `).join('');

        const catSuggestions = document.getElementById('menuCategorySuggestions');

        if (catSuggestions) {
            const uniqueCats = [...new Set(appState.menu.map(m => m.category))];

            catSuggestions.innerHTML = uniqueCats
                .map(c => `<option value="${c}">`)
                .join('');
        }

        document.getElementById('adminMenuManageList').innerHTML =
            appState.menu.map(m => `
                <div class="list-item-card">
                    <div>
                        <span style="font-size:10px; color:var(--accent-red); font-weight:700;">REITER: ${m.category}</span>
                        <strong style="display:block;">${m.name} — ${m.price.toFixed(2).replace('.', ',')} €</strong>
                        <span style="font-size:11px; color:#888;">${m.desc}</span>
                    </div>

                    <div style="display:flex; gap:6px;">
                        <button type="button" class="btn-white" style="padding:8px 12px;" onclick="editDish('${m.id}')">Bearbeiten</button>
                        <button type="button" class="btn-nav-outline" style="padding:8px 12px;" onclick="deleteDish('${m.id}')">✕</button>
                    </div>
                </div>
            `).join('');

        document.getElementById('workloadSelect').value = appState.status.workload;

        const whInput = document.getElementById('discordWebhookInput');

        if (!whInput.value) {
            whInput.value = appState.status.discordWebhook || '';
        }

        const inviteInput = document.getElementById('discordInviteInput');

        if (inviteInput && !inviteInput.value) {
            inviteInput.value = appState.status.discordInvite || '';
        }
    }

    // Stempeluhr: alle Ränge sehen den Dienststatus, können aber nur sich selbst stempeln.
    const activeCountForAll = appState.staff.filter(s => s.onDuty).length;

    const shopStatus = document.getElementById('kpiShopStatus');
    const activeKpi = document.getElementById('kpiActiveStaff');
    const workloadKpi = document.getElementById('kpiWorkload');
    const ordersKpi = document.getElementById('kpiOpenOrders');

    if (shopStatus) {
        shopStatus.textContent = appState.status.isOpen ? 'GEÖFFNET' : 'GESCHLOSSEN';
    }

    if (activeKpi) {
        activeKpi.textContent = `${activeCountForAll} / ${appState.staff.length}`;
    }

    if (workloadKpi) {
        workloadKpi.textContent = appState.status.workload || '—';
    }

    if (ordersKpi) {
        ordersKpi.textContent = appState.orders.filter(
            o => !['Fertig', 'Archiviert'].includes(o.status)
        ).length;
    }

    const myClockTitle = document.getElementById('personalClockTitle');
    const myClockSub = document.getElementById('personalClockSub');
    const myClockBtn = document.getElementById('personalClockBtn');

    if (myClockTitle && myClockSub && myClockBtn) {
        myClockTitle.textContent =
            `${currentUser.name} — ${currentUser.onDuty ? 'EINGESTEMPELT' : 'AUSGESTEMPELT'}`;

        myClockSub.textContent = currentUser.onDuty
            ? `Im Dienst seit ${currentUser.clockIn} Uhr (${currentUser.role})`
            : `Du bist aktuell nicht im Dienst (${currentUser.role}).`;

        myClockBtn.textContent = currentUser.onDuty
            ? 'JETZT AUSSTEMPELN'
            : 'JETZT EINSTEMPELN';

        myClockBtn.className = currentUser.onDuty ? 'btn-red' : 'btn-white';
    }

    const clockGrid = document.getElementById('clockStaffGrid');

    if (clockGrid) {
        clockGrid.innerHTML = appState.staff.map(s => `
            <div class="staff-card">
                <div>
                    <span style="font-size:10px;font-weight:700;color:${getRoleColor(s.role)};text-transform:uppercase;">${s.role}</span>
                    <strong style="display:block;font-size:16px;margin-top:2px;">${s.name}</strong>
                    <span style="font-size:12px;color:#aaa;">
                        ${s.onDuty ? `🟢 Im Dienst seit ${s.clockIn} Uhr` : '⚫ Nicht im Dienst'}
                    </span>
                </div>

                ${
                    String(s.id) === String(currentUser.id)
                        ? `<button type="button" class="${s.onDuty ? 'btn-red' : 'btn-white'}" onclick="toggleMyOwnClock()">${s.onDuty ? 'AUSSTEMPELN' : 'EINSTEMPELN'}</button>`
                        : (
                            isManagementUser(currentUser)
                                ? `<button type="button" class="${s.onDuty ? 'btn-red' : 'btn-white'}" onclick="toggleStaffDuty('${s.id}')">${s.onDuty ? 'AUSSTEMPELN' : 'EINSTEMPELN'}</button>`
                                : ''
                        )
                }
            </div>
        `).join('');
    }

    const vipReadOnly = document.getElementById('staffVipReadOnlyList');

    if (vipReadOnly) {
        const vipCustomers = (appState.customers || []).filter(
            c => c.vipStatus && c.vipStatus !== 'Kein'
        );

        vipReadOnly.innerHTML = vipCustomers.length
            ? vipCustomers.map(c => `
                <div class="list-item-card">
                    <strong>${c.username}</strong>
                    <span>${c.vipStatus}</span>
                </div>
            `).join('')
            : '<p style="color:#888;">Aktuell sind keine VIP-Kunden eingetragen.</p>';
    }

    const activeOrders = appState.orders.filter(o => o.status !== 'Archiviert');
    const archivedOrders = appState.orders.filter(o => o.status === 'Archiviert');

    document.getElementById('kitchenOrdersGrid').innerHTML =
        activeOrders.length === 0
            ? '<p style="color:#888;">Keine offenen Bestellungen.</p>'
            : activeOrders.map(o => `
                <div class="order-ticket ${o.status === 'Fertig' ? 'done' : ''}">
                    <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                        <strong>#${o.id} · ${o.table}</strong>
                        <span style="font-size:12px; color:#aaa;">${o.time} Uhr</span>
                    </div>

                    <ul style="list-style:none; font-size:13px; margin-bottom:14px;">
                        ${o.items.map(i => `<li>• ${i.qty}x ${i.name}</li>`).join('')}
                    </ul>

                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <strong>${o.total.toFixed(2).replace('.', ',')} €</strong>

                        ${
                            o.status !== 'Fertig'
                                ? `<button type="button" class="btn-red" onclick="markOrderDone('${o.id}')">FERTIG</button>`
                                : `<button type="button" class="btn-nav-outline" onclick="archiveOrder('${o.id}')">INS ARCHIV</button>`
                        }
                    </div>
                </div>
            `).join('');

    const archiveEl = document.getElementById('archivedOrdersGrid');

    if (archiveEl) {
        archiveEl.innerHTML = archivedOrders.length
            ? archivedOrders.map(o => `
                <div class="order-ticket done">
                    <div style="display:flex;justify-content:space-between;">
                        <strong>#${o.id} · ${o.table}</strong>
                        <span>${o.time || ''} Uhr</span>
                    </div>

                    <p style="font-size:12px;color:#aaa;margin:8px 0;">
                        ${(o.items || []).map(i => `${i.qty}x ${i.name}`).join(' · ')}
                    </p>

                    <strong>${Number(o.total || 0).toFixed(2).replace('.', ',')} €</strong>

                    <button type="button" class="btn-red" style="margin-top:10px;" onclick="deleteArchivedOrder('${o.id}')">
                        ENDGÜLTIG LÖSCHEN
                    </button>
                </div>
            `).join('')
            : '<p style="color:#888;">Das Archiv ist leer.</p>';
    }

    document.getElementById('posMenuGrid').innerHTML =
        appState.menu.map(item => `
            <button type="button" class="pos-btn" onclick="addToPos('${item.id}')">
                <div style="font-weight:600; font-size:13px;">${item.name}</div>
                <div style="color:var(--accent-red); font-size:12px; margin-top:4px;">
                    ${item.price.toFixed(2).replace('.', ',')} €
                </div>
            </button>
        `).join('');

    renderPosTicket();

    document.getElementById('staffResList').innerHTML =
        appState.reservations.length === 0
            ? '<p style="color:#888;">Keine offenen Reservierungen.</p>'
            : appState.reservations.map(r => `
                <div class="list-item-card" style="margin-top:10px;">
                    <div>
                        <strong>${r.name} (${r.guests} Personen)</strong>
                        <div style="font-size:12px; color:#aaa; margin-top:2px;">
                            Wann: ${escHtml(fmtDate(r.date))} · ${escHtml(r.time)} Uhr · Bereich: ${escHtml(r.type)}
                        </div>
                        <div style="font-size:12px; color:#aaa; margin-top:2px;">
                            📞 ${r.phone ? `<code>${escHtml(r.phone)}</code>` : 'Nicht angegeben'}
                            · Anmerkungen: ${r.notes ? escHtml(r.notes) : 'Keine'}
                        </div>
                    </div>

                    <div style="display:flex; align-items:center; gap:10px;">
                        <span style="color:var(--green-live); font-size:12px;">${r.status}</span>
                        <button type="button" class="btn-red" style="padding:6px 12px; font-size:12px;" onclick="deleteReservation('${r.id}')">
                            Löschen
                        </button>
                    </div>
                </div>
            `).join('');
}

// =====================================================
// KUNDENKONTO LÖSCHEN – KORRIGIERTE VERSION
// =====================================================

async function deleteCustomer(id) {
    if (!isManagementUser(currentUser)) {
        showToast('❌ Nur die Geschäftsleitung darf Kundenkonten löschen.');
        return;
    }

    const customerId = String(id);

    const customer = (appState.customers || []).find(
        c => String(c.id) === customerId
    );

    if (!customer) {
        showToast('❌ Kunde nicht gefunden.');
        return;
    }

    const username = customer.username || 'Unbekannter Kunde';

    const ok = await showActionConfirm(
        'Kundenkonto endgültig löschen?',
        `Das Konto von ${username} wird dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.`,
        'Ja, endgültig löschen'
    );

    if (!ok) return;

    try {
        showToast('⏳ Kundenkonto wird gelöscht …');

        const res = await fetch(
            `/api/admin/customer/${encodeURIComponent(customerId)}`,
            {
                method: 'DELETE',
                headers: {
                    'Accept': 'application/json'
                },
                cache: 'no-store'
            }
        );

        const result = await res.json().catch(() => ({}));

        if (!res.ok || result.error) {
            throw new Error(
                result.error || `Löschen fehlgeschlagen (HTTP ${res.status})`
            );
        }

        await fetchState();

        const stillExists = (appState.customers || []).some(
            c => String(c.id) === customerId
        );

        if (stillExists) {
            throw new Error(
                'Der Kunde wurde vom Server nicht aus der Kundenliste entfernt.'
            );
        }

        showToast(`✅ Kundenkonto von ${username} wurde gelöscht.`);

    } catch (error) {
        console.error('Kundenkonto löschen:', error);

        showToast(
            '❌ ' + (
                error.message ||
                'Kundenkonto konnte nicht gelöscht werden.'
            )
        );
    }
}

async function updateCustomerStatus(id, vipStatus, isStammkunde, hasHausverbot) {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    await fetch(`/api/admin/customer/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vipStatus, isStammkunde, hasHausverbot })
    });

    await fetchState();

    showToast('✅ Kundenstatus aktualisiert');
}

async function handleVipAppAction(id, action) {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    await fetch(`/api/vip/applications/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
    });

    await fetchState();

    showToast(`✅ Antrag auf „${action}“ gesetzt!`);
}

async function deleteVipApp(id) {
    if (!isManagementUser(currentUser)) return showToast('❌ Nur Führungsebene');

    const ok = await showActionConfirm('Antrag löschen?', 'Der abgelehnte Antrag wird dauerhaft entfernt.', 'Ja, löschen');
    if (!ok) return;

    const res = await fetch(`/api/vip/applications/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) return showToast('❌ ' + (data.error || 'Löschen fehlgeschlagen'));

    await fetchState();
    showToast('🗑️ Antrag gelöscht');
}

async function deleteRejectedVipApps() {
    if (!isManagementUser(currentUser)) return showToast('❌ Nur Führungsebene');

    const count = (appState.vipApplications || []).filter(a => a.status === 'Abgelehnt').length;
    if (!count) return showToast('Keine abgelehnten Anträge vorhanden.');

    const ok = await showActionConfirm('Alle abgelehnten löschen?', `${count} abgelehnte Anträge werden dauerhaft entfernt.`, 'Ja, alle löschen');
    if (!ok) return;

    const res = await fetch('/api/vip/applications-delete-rejected', { method: 'POST' });
    if (!res.ok) return showToast('❌ Löschen fehlgeschlagen');

    await fetchState();
    showToast('🗑️ Abgelehnte Anträge gelöscht');
}

// Termine
let lastApptSig = '';

function escHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderAppointments() {
    const el = document.getElementById('adminAppointmentsList');
    if (!el) return;

    const list = appState.appointments || [];
    const sig = JSON.stringify(list);

    // Nicht neu zeichnen, wenn sich nichts geändert hat (sonst gehen Eingaben im 5s-Takt verloren)
    if (sig === lastApptSig && el.innerHTML) return;
    lastApptSig = sig;

    const colors = { 'In Bearbeitung': '#aaa', 'Akzeptiert': '#2ecc71', 'Abgelehnt': '#c82333', 'Verschoben': '#e67e22' };

    el.innerHTML = list.length === 0
        ? '<p style="color:#888;">Keine Terminanfragen.</p>'
        : list.map(a => `
            <div class="list-item-card" style="flex-direction:column; align-items:stretch; gap:10px; margin-bottom:10px;">
                <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
                    <div>
                        <strong>${escHtml(a.name)}</strong>
                        <span style="color:#888; font-size:12px;">(Konto: ${escHtml(a.customerUsername)})</span>
                        <div style="font-size:13px; color:#ccc; margin-top:4px;">${escHtml(a.concern)}</div>
                        <div style="font-size:12px; color:#aaa; margin-top:4px;">
                            📅 ${escHtml(fmtDate(a.date))} · 🕒 ${escHtml(a.time)} · 📞 <code>${escHtml(a.phone)}</code>
                            ${a.origDate ? `<br>Ursprünglich: ${escHtml(fmtDate(a.origDate))} ${escHtml(a.origTime)}` : ''}
                        </div>
                    </div>
                    <strong style="color:${colors[a.status] || '#aaa'};">${escHtml(a.status)}</strong>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                    <button type="button" class="btn-white" style="padding:6px 10px; font-size:11px; background:#2ecc71; color:#fff;" onclick="appointmentAction('${a.id}', 'Akzeptiert')">Akzeptieren</button>
                    <input type="date" id="apptDate_${a.id}" value="${escHtml(a.date)}" style="width:auto; padding:5px;">
                    <input type="time" id="apptTime_${a.id}" value="${escHtml(a.time)}" style="width:auto; padding:5px;">
                    <button type="button" class="btn-white" style="padding:6px 10px; font-size:11px; background:#e67e22; color:#fff;" onclick="appointmentAction('${a.id}', 'Verschoben')">Verschieben</button>
                    <button type="button" class="btn-red" style="padding:6px 10px; font-size:11px;" onclick="appointmentAction('${a.id}', 'Abgelehnt')">Ablehnen</button>
                    <button type="button" class="btn-nav-outline" style="padding:6px 10px; font-size:11px;" onclick="deleteAppointment('${a.id}')">🗑️</button>
                </div>
            </div>
        `).join('');
}

async function appointmentAction(id, action) {
    if (!isManagementUser(currentUser)) return showToast('❌ Nur Führungsebene');

    const body = { action };

    if (action === 'Verschoben') {
        body.date = (document.getElementById(`apptDate_${id}`) || {}).value;
        body.time = (document.getElementById(`apptTime_${id}`) || {}).value;
        if (!body.date || !body.time) return showToast('❌ Neues Datum und Uhrzeit wählen.');
    }

    const res = await fetch(`/api/appointments/${encodeURIComponent(id)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) return showToast('❌ ' + (data.error || 'Fehler'));

    await fetchState();
    showToast(`✅ Termin: ${action}`);
}

async function deleteAppointment(id) {
    if (!isManagementUser(currentUser)) return showToast('❌ Nur Führungsebene');

    const ok = await showActionConfirm('Termin löschen?', 'Der Termin wird auch im Kundenkonto entfernt.', 'Ja, löschen');
    if (!ok) return;

    await fetch(`/api/appointments/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await fetchState();
    showToast('🗑️ Termin gelöscht');
}

async function toggleMyOwnClock() {
    if (currentUser) {
        await toggleStaffDuty(currentUser.id);
    }
}

async function toggleStaffDuty(id) {
    if (!currentUser) return;

    if (
        String(id) !== String(currentUser.id) &&
        !isManagementUser(currentUser)
    ) {
        return showToast('❌ Du kannst nur dich selbst einstempeln.');
    }

    await fetch('/api/staff/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    });

    await fetchState();

    showToast('Stempeluhr aktualisiert');
}

function selectStaffForPhoto(id) {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    const s = appState.staff.find(m => String(m.id) === String(id));

    if (!s) return;

    document.getElementById('editPhotoStaffId').value = s.id;
    document.getElementById('photoFormHeading').textContent = `Bearbeite: ${s.name}`;
    document.getElementById('photoStaffName').value = s.name;
    document.getElementById('photoStaffRole').value = s.role;
    document.getElementById('photoStaffUrl').value = s.avatar;

    uploadedPhotoBase64 = '';
}

async function saveTeamPhotoChanges() {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    const id = document.getElementById('editPhotoStaffId').value;

    if (!id) {
        return showToast('Bitte zuerst rechts auf „Bild / Rang bearbeiten“ klicken!');
    }

    const name = document.getElementById('photoStaffName').value.trim();
    const role = document.getElementById('photoStaffRole').value;
    const urlInput = document.getElementById('photoStaffUrl').value.trim();

    const avatar = uploadedPhotoBase64 ||
        (urlInput && urlInput !== '(Neues Bild ausgewählt)' ? urlInput : undefined);

    await fetch(`/api/staff/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, avatar })
    });

    uploadedPhotoBase64 = '';

    await fetchState();

    showToast(`✅ Bild & Daten von ${name} gespeichert!`);
}

async function createAccount() {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    const name = document.getElementById('newAccName').value.trim();
    const role = document.getElementById('newAccRole').value;
    const pin = document.getElementById('newAccPin').value.trim() || '1234';

    if (!name) {
        return showToast('Bitte Namen eingeben');
    }

    await fetch('/api/staff/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role, pin })
    });

    document.getElementById('newAccName').value = '';
    document.getElementById('newAccPin').value = '';

    await fetchState();

    showToast(`✅ Konto für ${name} angelegt!`);
}

function promptChangePin(id, name) {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    const modal = document.getElementById('customPinModal');
    const input = document.getElementById('newPinModalInput');

    input.value = '';
    modal.classList.add('open');

    setTimeout(() => input.focus(), 50);

    document.getElementById('pinModalSaveBtn').onclick = async () => {
        const newPin = input.value.trim();

        if (newPin.length < 4) {
            return showToast('❌ Bitte genau 4 Ziffern eingeben');
        }

        await fetch(`/api/staff/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: newPin })
        });

        closeCustomModal('customPinModal');

        await fetchState();

        showToast('✅ PIN geändert');
    };
}

function deleteAccount(id, name) {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    const modal = document.getElementById('customConfirmModal');

    document.getElementById('confirmModalTitle').textContent =
        'Mitarbeiterkonto löschen?';

    document.getElementById('confirmModalMessage').textContent =
        `Das Konto von ${name} wird endgültig entfernt.`;

    document.getElementById('confirmModalActionBtn').textContent =
        'Konto löschen';

    modal.classList.add('open');

    document.getElementById('confirmModalCancelBtn').onclick = () => {
        closeCustomModal('customConfirmModal');
    };

    document.getElementById('confirmModalActionBtn').onclick = async () => {
        await fetch(`/api/staff/${id}`, { method: 'DELETE' });

        closeCustomModal('customConfirmModal');

        await fetchState();

        showToast('🗑️ Konto gelöscht');
    };
}

async function createNewRole() {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    const name = document.getElementById('newRoleName').value.trim();
    const color = document.getElementById('newRoleColor').value;
    const isManagement = document.getElementById('newRoleIsManagement').checked;

    if (!name) {
        return showToast('Bitte Rollennamen eingeben');
    }

    await fetch('/api/roles/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color, isManagement })
    });

    document.getElementById('newRoleName').value = '';
    document.getElementById('newRoleIsManagement').checked = false;

    await fetchState();

    showToast('🎖️ Rolle erstellt');
}

async function deleteRole(id) {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    await fetch(`/api/roles/${id}`, { method: 'DELETE' });

    await fetchState();
}

function editDish(id) {
    const d = appState.menu.find(m => String(m.id) === String(id));

    if (!d) return;

    document.getElementById('editDishId').value = d.id;
    document.getElementById('dishFormHeading').textContent = `Bearbeite: ${d.name}`;
    document.getElementById('dishNameInput').value = d.name;
    document.getElementById('dishCatInput').value = d.category;
    document.getElementById('dishPriceInput').value = d.price;
    document.getElementById('dishDescInput').value = d.desc;
}

async function saveDish() {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    const id = document.getElementById('editDishId').value;
    const name = document.getElementById('dishNameInput').value.trim();
    const category = document.getElementById('dishCatInput').value.trim() || 'Allgemein';
    const price = document.getElementById('dishPriceInput').value;
    const desc = document.getElementById('dishDescInput').value.trim();

    if (!name || !price) {
        return showToast('Name und Preis angeben');
    }

    if (id) {
        await fetch(`/api/menu/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, category, price, desc })
        });
    } else {
        await fetch('/api/menu/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, category, price, desc })
        });
    }

    await fetchState();

    showToast('✅ Gespeichert');
}

async function deleteDish(id) {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    await fetch(`/api/menu/${id}`, { method: 'DELETE' });

    await fetchState();
}

async function deleteReservation(id) {
    await fetch(`/api/reservations/${id}`, { method: 'DELETE' });

    await fetchState();

    showToast('🗑️ Reservierung gelöscht');
}

function addToPos(id) {
    const item = appState.menu.find(i => String(i.id) === String(id));
    const existing = posCart.find(c => String(c.id) === String(id));

    if (existing) {
        existing.qty++;
    } else {
        posCart.push({ ...item, qty: 1 });
    }

    renderPosTicket();
}

function setPosQty(id, value) {
    const item = posCart.find(i => String(i.id) === String(id));

    if (!item) return;

    const qty = Math.max(1, Math.min(999, Math.floor(Number(value) || 1)));

    item.qty = qty;

    renderPosTicket();
}

function removePosItem(id) {
    posCart = posCart.filter(item => String(item.id) !== String(id));

    renderPosTicket();
}

function renderPosTicket() {
    let total = 0;

    document.getElementById('posItemsList').innerHTML =
        posCart.map(i => {
            total += i.price * i.qty;

            return `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; font-size:13px; margin:8px 0;">
                    <span style="flex:1;">
                        ${i.name}
                        <small style="display:block;color:#999;">
                            ${Number(i.price).toFixed(2).replace('.', ',')} € / Stück
                        </small>
                    </span>

                    <label style="display:flex;align-items:center;gap:6px;">
                        Anzahl
                        <input aria-label="Anzahl ${i.name}" type="number" min="1" max="999" value="${i.qty}" onchange="setPosQty('${i.id}', this.value)" style="width:64px;padding:7px;background:#181818;color:#fff;border:1px solid #555;border-radius:6px;">
                    </label>

                    <strong style="min-width:75px;text-align:right;">
                        ${(i.price * i.qty).toFixed(2).replace('.', ',')} €
                    </strong>

                    <button
                        type="button"
                        aria-label="${i.name} vom Bon entfernen"
                        title="Vom Bon entfernen"
                        onclick="removePosItem('${i.id}')"
                        style="border:1px solid #8b3434;background:#351b1b;color:#ffb4b4;border-radius:7px;padding:7px 10px;cursor:pointer;font-size:16px;line-height:1;">
                        ✕
                    </button>
                </div>
            `;
        }).join('');

    document.getElementById('posTotal').textContent =
        `${total.toFixed(2).replace('.', ',')} €`;
}

async function submitPosOrder() {
    if (posCart.length === 0) return;

    const table = document.getElementById('posTableInput').value || 'Tisch';

    const total = posCart.reduce(
        (s, i) => s + i.price * i.qty,
        0
    );

    await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            staffId: currentUser ? currentUser.id : null,
            customer: currentUser ? currentUser.name : 'POS',
            table,
            items: posCart,
            total
        })
    });

    posCart = [];

    showToast('✅ Bon gesendet');

    await fetchState();
}

function showActionConfirm(title, message, actionLabel) {
    return new Promise(resolve => {
        const modal = document.getElementById('customConfirmModal');

        if (!modal) {
            return resolve(window.confirm(`${title}\n${message}`));
        }

        const titleEl = document.getElementById('confirmModalTitle');
        const messageEl = document.getElementById('confirmModalMessage');
        const actionBtn = document.getElementById('confirmModalActionBtn');
        const cancelBtn = document.getElementById('confirmModalCancelBtn');

        if (!titleEl || !messageEl || !actionBtn || !cancelBtn) {
            return resolve(window.confirm(`${title}\n${message}`));
        }

        titleEl.textContent = title;
        messageEl.textContent = message;
        actionBtn.textContent = actionLabel;

        modal.classList.add('open');

        const finish = value => {
            modal.classList.remove('open');
            actionBtn.onclick = null;
            cancelBtn.onclick = null;
            resolve(value);
        };

        actionBtn.onclick = () => finish(true);
        cancelBtn.onclick = () => finish(false);
    });
}

async function archiveOrder(id) {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    const ok = await showActionConfirm(
        `Bestellung #${id} archivieren?`,
        'Die Bestellung wird aus der Live-Küche ins Archiv verschoben.',
        'Ins Archiv'
    );

    if (!ok) return;

    const res = await fetch(`/api/orders/${id}/archive`, {
        method: 'POST'
    });

    if (!res.ok) {
        const e = await res.json();
        return showToast(e.error || 'Archivieren fehlgeschlagen');
    }

    await fetchState();

    showToast('Bestellung archiviert');
}

async function deleteArchivedOrder(id) {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    const ok = await showActionConfirm(
        `Bestellung #${id} endgültig löschen?`,
        'Diese Aktion kann nicht rückgängig gemacht werden.',
        'Endgültig löschen'
    );

    if (!ok) return;

    const res = await fetch(`/api/orders/${id}`, {
        method: 'DELETE'
    });

    if (!res.ok) {
        const e = await res.json();
        return showToast(e.error || 'Löschen fehlgeschlagen');
    }

    await fetchState();

    showToast('Archivierte Bestellung gelöscht');
}

async function markOrderDone(id) {
    await fetch(`/api/orders/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Fertig' })
    });

    await fetchState();
}

async function toggleShopOpen() {
    if (!currentUser) return;

    const res = await fetch('/api/shop/toggle', {
        method: 'POST'
    });

    if (!res.ok) {
        const e = await res.json();
        return showToast(e.error || 'Status konnte nicht geändert werden');
    }

    await fetchState();

    showToast(
        appState.status.isOpen
            ? 'Der Laden ist jetzt geöffnet.'
            : 'Der Laden ist jetzt geschlossen.'
    );
}

async function changeWorkload(workload) {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workload })
    });

    await fetchState();
}

async function saveWebhook() {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    const discordWebhook =
        document.getElementById('discordWebhookInput').value;

    await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordWebhook })
    });

    showToast('Webhook gespeichert');
}

async function saveDiscordInvite() {
    if (!isManagementUser(currentUser)) {
        return showToast('❌ Nur Führungsebene');
    }

    const discordInvite =
        document.getElementById('discordInviteInput').value.trim();

    if (
        discordInvite &&
        !/^https:\/\/(discord\.gg|discord\.com\/invite)\//i.test(discordInvite)
    ) {
        return showToast('Bitte einen gültigen Discord-Einladungslink eingeben.');
    }

    const res = await fetch('/api/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordInvite })
    });

    if (!res.ok) {
        return showToast('Discord-Link konnte nicht gespeichert werden');
    }

    await fetchState();

    showToast('Discord-Einladungslink gespeichert');
}

function showToast(msg) {
    const t = document.getElementById('toast');

    if (!t) return;

    t.textContent = msg;
    t.style.display = 'block';

    setTimeout(() => {
        t.style.display = 'none';
    }, 4000);
}

function showCenterAlert(text) {
    const modal = document.getElementById('centerNotificationModal');
    const textEl = document.getElementById('centerAlertText');

    if (!modal || !textEl) return;

    textEl.textContent = text;
    modal.classList.add('open');
}

function closeCenterNotification() {
    const modal = document.getElementById('centerNotificationModal');

    if (modal) {
        modal.classList.remove('open');
    }
}

// 2026-11-17 -> 17.11.2026
function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[3] + '.' + m[2] + '.' + m[1] : String(iso || '');
}
