
let appState = null;
let cart = [];
let activeCategory = null;
let currentCustomer = null;
let isRegisterMode = false;
let selectedVipTier = '';

document.addEventListener('DOMContentLoaded', async () => {
    const savedCustomer = sessionStorage.getItem('soulSushiCustomer');

    if (savedCustomer) {
        try {
            currentCustomer = JSON.parse(savedCustomer);
            updateCustomerNavUI();
        } catch (err) {
            console.error('Fehler beim Laden des Kundenkontos:', err);
            sessionStorage.removeItem('soulSushiCustomer');
        }
    }

    await fetchAppState();
    setInterval(fetchAppState, 5000);
});

async function fetchAppState() {
    try {
        const res = await fetch('/api/state');

        if (!res.ok) {
            throw new Error('Fehler beim Laden des States');
        }

        appState = await res.json();

        const discordAnchor = document.getElementById('discordInviteAnchor');

        if (discordAnchor) {
            const invite = appState && appState.status
                ? String(appState.status.discordInvite || '').trim()
                : '';

            if (invite && /^https:\/\/(discord\.gg|discord\.com\/invite)\//i.test(invite)) {
                discordAnchor.href = invite;
                discordAnchor.style.display = 'inline-block';
            } else {
                discordAnchor.removeAttribute('href');
                discordAnchor.style.display = 'none';
            }
        }

        if (currentCustomer && appState.customers) {
            const updated = appState.customers.find(
                c => String(c.id) === String(currentCustomer.id)
            );

            if (updated) {
                currentCustomer = updated;
                sessionStorage.setItem(
                    'soulSushiCustomer',
                    JSON.stringify(currentCustomer)
                );
                updateCustomerNavUI();
            }
        }

        renderFrontend();

    } catch (err) {
        console.error('Fehler beim Laden des States:', err);
    }
}

function renderFrontend() {
    if (!appState) return;

    const badge = document.getElementById('shopStatusBadge');
    const statusText = document.getElementById('shopStatusText');
    const heroStatusSpan = document.getElementById('heroStatusSpan');
    const heroActiveStaff = document.getElementById('heroActiveStaff');
    const heroWorkload = document.getElementById('heroWorkload');

    const isOpen = appState.status.isOpen;

    if (badge) {
        badge.className = isOpen
            ? 'status-badge open'
            : 'status-badge closed';
    }

    if (statusText) {
        statusText.textContent = isOpen ? 'GEÖFFNET' : 'GESCHLOSSEN';
    }

    if (heroStatusSpan) {
        heroStatusSpan.textContent = isOpen ? 'GEÖFFNET' : 'GESCHLOSSEN';
    }

    const activeStaffCount = appState.staff.filter(s => s.onDuty).length;

    if (heroActiveStaff) {
        heroActiveStaff.textContent = `${activeStaffCount} im Dienst`;
    }

    if (heroWorkload) {
        heroWorkload.textContent = appState.status.workload;
    }

    renderMenu();
    renderTeam();
    renderNewsAndJobs();
    updateCartCount();
}

function renderMenu() {
    const tabsContainer = document.getElementById('menuTabsContainer');
    const gridContainer = document.getElementById('menuGridContainer');

    if (!tabsContainer || !gridContainer) return;

    const categories = [...new Set(appState.menu.map(m => m.category))];

    if (!activeCategory && categories.length > 0) {
        activeCategory = categories[0];
    }

    tabsContainer.innerHTML = categories.map(cat => `
        <button
            type="button"
            class="btn-nav-outline ${cat === activeCategory ? 'active' : ''}"
            onclick="selectMenuCategory('${cat}')"
        >
            ${cat}
        </button>
    `).join('');

    const filteredDishes = appState.menu.filter(
        m => m.category === activeCategory
    );

    gridContainer.innerHTML = filteredDishes.map(d => `
        <div class="dish-card">
            <div>
                <div class="dish-top">
                    <h4>${d.name}</h4>
                    <strong class="dish-price">${d.price.toFixed(2).replace('.', ',')} €</strong>
                </div>
                <p class="dish-desc">${d.desc || ''}</p>
            </div>
            <div class="dish-actions">
                <div class="qty-stepper" role="group" aria-label="Menge ${d.name}">
                    <button type="button" class="qty-btn" aria-label="Weniger" onclick="changeMenuQty(${d.id}, -1)">−</button>
                    <span class="qty-val" id="menuQty-${d.id}">${menuQty[d.id] || 1}</span>
                    <button type="button" class="qty-btn" aria-label="Mehr" onclick="changeMenuQty(${d.id}, 1)">+</button>
                </div>
                <button type="button" class="btn-red" onclick="addToCart(${d.id})">
                    In den Warenkorb
                </button>
            </div>
        </div>
    `).join('');
}

const menuQty = {};

function changeMenuQty(id, delta) {
    const q = Math.max(1, Math.min(99, (menuQty[id] || 1) + delta));
    menuQty[id] = q;
    const el = document.getElementById('menuQty-' + id);
    if (el) el.textContent = q;
}

function selectMenuCategory(cat) {
    activeCategory = cat;
    renderMenu();
}

function renderTeam() {
    const teamContainer = document.getElementById('teamGridContainer');

    if (!teamContainer) return;

    teamContainer.innerHTML = appState.staff.map(s => `
        <div class="team-card">
            <div class="team-photo">
                <img
                    src="${s.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80'}"
                    alt="${s.name}"
                    loading="lazy"
                >
                <span class="team-duty ${s.onDuty ? 'on' : 'off'}">${s.onDuty ? 'Im Dienst' : 'Frei'}</span>
            </div>
            <div class="team-info">
                <span class="team-role">${s.role}</span>
                <h4>${s.name}</h4>
            </div>
        </div>
    `).join('');
}

function addToCart(id) {
    if (currentCustomer && currentCustomer.hasHausverbot) {
        return showToast('❌ Du hast Hausverbot und kannst keine Bestellung aufgeben.');
    }

    const item = appState.menu.find(m => m.id === id);

    if (!item) return;

    const amount = menuQty[id] || 1;
    const existing = cart.find(c => c.id === id);

    if (existing) {
        existing.qty = Math.min(99, existing.qty + amount);
    } else {
        cart.push({ ...item, qty: amount });
    }

    menuQty[id] = 1;
    const qtyEl = document.getElementById('menuQty-' + id);
    if (qtyEl) qtyEl.textContent = 1;

    updateCartCount();
    showToast(`✅ ${amount}x ${item.name} zum Warenkorb hinzugefügt`);
}

function updateCartCount() {
    const count = cart.reduce((sum, i) => sum + i.qty, 0);
    const el = document.getElementById('cartCount');

    if (el) {
        el.textContent = count;
    }
}

function openCartModal() {
    const modal = document.getElementById('cartModal');
    const list = document.getElementById('cartItemsList');
    const totalEl = document.getElementById('cartModalTotal');

    if (!modal || !list || !totalEl) return;

    let total = 0;

    list.innerHTML = cart.length === 0
        ? '<p style="color:#888; text-align:center;">Dein Warenkorb ist leer.</p>'
        : cart.map(i => {
            total += i.price * i.qty;

            return `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; font-size:14px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:8px;">
                    <div>
                        <strong>${i.name}</strong><br>
                        <span style="color:#aaa; font-size:12px;">
                            ${i.price.toFixed(2)} € / Stück
                        </span>
                    </div>
                    <div class="qty-stepper" role="group" aria-label="Menge ${i.name}">
                        <button type="button" class="qty-btn" aria-label="Weniger" onclick="changeCartQty(${i.id}, -1)">−</button>
                        <span class="qty-val">${i.qty}</span>
                        <button type="button" class="qty-btn" aria-label="Mehr" onclick="changeCartQty(${i.id}, 1)">+</button>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <strong>${(i.price * i.qty).toFixed(2)} €</strong>
                        <button
                            type="button"
                            onclick="removeFromCart(${i.id})"
                            style="background:none; border:none; color:#c82333; cursor:pointer; font-weight:bold;"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            `;
        }).join('');

    const discountPercent = (
        currentCustomer && currentCustomer.discount
    ) ? currentCustomer.discount : 0;

    const finalTotal = total * (1 - discountPercent / 100);

    if (discountPercent > 0) {
        totalEl.innerHTML = `
            <span style="text-decoration: line-through; color: #888; font-size: 13px; margin-right: 8px;">
                ${total.toFixed(2).replace('.', ',')} €
            </span>
            ${finalTotal.toFixed(2).replace('.', ',')} €
            <small style="color: #2ecc71; font-size: 11px;">
                (${discountPercent}% VIP-Rabatt)
            </small>
        `;
    } else {
        totalEl.textContent = `${total.toFixed(2).replace('.', ',')} €`;
    }

    const nameEl = document.getElementById('orderName');
    if (nameEl && !nameEl.value && currentCustomer && currentCustomer.username) nameEl.value = currentCustomer.username;

    modal.classList.add('open');
}

function changeCartQty(id, delta) {
    const item = cart.find(i => i.id === id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) return removeFromCart(id);
    item.qty = Math.min(99, item.qty);
    updateCartCount();
    openCartModal();
}

function removeFromCart(id) {
    cart = cart.filter(i => i.id !== id);
    updateCartCount();
    openCartModal();
}

function closeCartModal() {
    const modal = document.getElementById('cartModal');

    if (modal) {
        modal.classList.remove('open');
    }
}

async function checkoutOrder() {
    if (currentCustomer && currentCustomer.hasHausverbot) {
        return showToast('❌ Du hast Hausverbot.');
    }

    if (cart.length === 0) {
        return showToast('Warenkorb ist leer');
    }

    const rawTotal = cart.reduce(
        (sum, i) => sum + (i.price * i.qty),
        0
    );

    const discountPercent = (
        currentCustomer && currentCustomer.discount
    ) ? currentCustomer.discount : 0;

    const total = rawTotal * (1 - discountPercent / 100);

    const val = id => ((document.getElementById(id) || {}).value || '').trim();
    const delivery = {
        name: val('orderName'),
        zip: val('orderZip'),
        phone: val('orderPhone'),
        notes: val('orderNotes')
    };

    if (!delivery.name) return showToast('Bitte deinen Namen angeben');
    if (!/^\d{1,10}$/.test(delivery.zip)) return showToast('Bitte eine gültige PLZ angeben');
    if (delivery.phone.replace(/\D/g, '').length < 1) return showToast('Bitte eine Telefonnummer angeben');

    const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            customer: currentCustomer
                ? currentCustomer.username
                : delivery.name,
            table: 'Lieferung / Abholung',
            delivery,
            items: cart,
            total: total
        })
    });

    if (!res.ok) {
        let msg = 'Bestellung konnte nicht gesendet werden';
        try { msg = (await res.json()).error || msg; } catch (e) {}
        return showToast('❌ ' + msg);
    }

    cart = [];
    updateCartCount();
    ['orderName', 'orderZip', 'orderPhone', 'orderNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    closeCartModal();
    showToast('🎉 Bestellung erfolgreich abgesendet!');
}

function openReservationModal() {
    if (currentCustomer && currentCustomer.hasHausverbot) {
        return showToast('❌ Du hast Hausverbot.');
    }

    const modal = document.getElementById('reservationModal');

    initReservationMap();

    if (modal) {
        modal.classList.add('open');
    }
}

function closeReservationModal() {
    const modal = document.getElementById('reservationModal');

    if (modal) {
        modal.classList.remove('open');
    }
}

async function submitReservation(event) {
    event.preventDefault();

    if (currentCustomer && currentCustomer.hasHausverbot) {
        return showToast('❌ Hausverbot');
    }

    const name = document.getElementById('resName').value.trim();
    const guests = parseInt(
        document.getElementById('resGuests').value,
        10
    );

    const date = document.getElementById('resDate').dataset.iso || '';
    const time = document.getElementById('resTime').value.trim();
    const type = document.getElementById('resType').value;
    const phone = document.getElementById('resPhone').value.trim();
    const notes = document.getElementById('resNotes').value.trim();
    const tables = window.FloorPlan ? FloorPlan.selected() : [];

    if (
        !name ||
        !date ||
        !time ||
        !phone ||
        !Number.isInteger(guests) ||
        guests < 1
    ) {
        return showToast('❌ Bitte überprüfe deine Reservierungsdaten.');
    }

    if (tables.length && tables[0].charAt(0) === 'B') {
        const seatsChosen = tables.length;
        if (seatsChosen < guests) {
            return showToast(`❌ Für ${guests} Personen brauchst du ${guests} Barhocker (gewählt: ${seatsChosen}).`);
        }
    }

    try {
        const response = await fetch('/api/reservations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name,
                guests,
                date,
                time,
                type,
                phone,
                notes,
                tables
            })
        });

        const result = await response.json();

        if (!response.ok || result.error) {
            throw new Error(
                result.error || 'Reservierung fehlgeschlagen'
            );
        }

        closeReservationModal();
        showToast('📅 Reservierung erfolgreich gesendet!');

        document.getElementById('resName').value = '';
        document.getElementById('resPhone').value = '';
        document.getElementById('resNotes').value = '';
        if (window.resetDatePick) window.resetDatePick('resDate');
        if (window.FloorPlan) FloorPlan.reset();
        updateTakenTables();

    } catch (error) {
        console.error('Reservierungsfehler:', error);
        showToast('❌ Reservierungsfehler: ' + error.message);
    }
}

// VIP Antrag Funktionen

function openVipApplyModal(tier) {
    console.log('VIP-Button geklickt für:', tier);

    if (!currentCustomer) {
        showToast('🔑 Bitte logge dich zuerst ein, um VIP zu beantragen.');
        openCustomerAuthModal();
        return;
    }

    if (currentCustomer.hasHausverbot) {
        showToast('❌ Du hast Hausverbot und kannst keine Anträge stellen.');
        return;
    }

    selectedVipTier = tier;

    const titleEl = document.getElementById('vipApplyTitle');
    const tierEl = document.getElementById('vipApplyTier');
    const modalEl = document.getElementById('vipApplyModal');

    if (titleEl) {
        titleEl.textContent = `${tier} beantragen`;
    }

    if (tierEl) {
        tierEl.value = tier;
    }

    if (modalEl) {
        modalEl.classList.add('open');
    } else {
        console.error('Fehler: #vipApplyModal wurde im HTML nicht gefunden!');
        showToast('❌ Fehler: Modal in HTML nicht gefunden.');
    }
}

function closeVipApplyModal() {
    const modalEl = document.getElementById('vipApplyModal');

    if (modalEl) {
        modalEl.classList.remove('open');
    }
}

async function submitVipApplication(event) {
    event.preventDefault();

    const phoneInput = document.getElementById('vipApplyPhone');
    const phone = phoneInput ? phoneInput.value.trim() : '';

    if (!phone || !currentCustomer) return;

    try {
        const res = await fetch('/api/vip/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: currentCustomer.username,
                phone: phone,
                tier: selectedVipTier
            })
        });

        if (!res.ok) {
            throw new Error('Fehler');
        }

        closeVipApplyModal();

        showToast(
            '🎉 VIP-Antrag erfolgreich eingereicht! Die Leitungsebene wurde informiert.'
        );

        if (phoneInput) {
            phoneInput.value = '';
        }

    } catch (err) {
        console.error('VIP-Antragsfehler:', err);
        showToast('❌ Fehler beim Einreichen.');
    }
}

// Kunden-Auth & Profil

function openCustomerAuthModal() {
    if (currentCustomer) {
        document.getElementById('profileUsernameTitle').textContent =
            `Konto: ${currentCustomer.username}`;

        document.getElementById('profileVipBadge').textContent =
            currentCustomer.vipStatus || 'Kein';

        document.getElementById('profileStammBadge').textContent =
            currentCustomer.isStammkunde ? 'Ja' : 'Nein';

        const hvBadge = document.getElementById('profileHausverbotBadge');

        if (currentCustomer.hasHausverbot) {
            hvBadge.textContent = 'JA (HAUSVERBOT AKTIV)';
            hvBadge.style.color = '#c82333';
        } else {
            hvBadge.textContent = 'Nein';
            hvBadge.style.color = '#2ecc71';
        }

        document.getElementById('profileDiscount').textContent =
            `${currentCustomer.discount || 0} %`;

        document.getElementById('customerProfileModal').classList.add('open');

        loadMyAppointments();

    } else {
        document.getElementById('customerAuthModal').classList.add('open');
    }
}

function closeCustomerAuthModal() {
    const authModal = document.getElementById('customerAuthModal');
    const profileModal = document.getElementById('customerProfileModal');

    if (authModal) {
        authModal.classList.remove('open');
    }

    if (profileModal) {
        profileModal.classList.remove('open');
    }
}

function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;

    document.getElementById('authModalTitle').textContent =
        isRegisterMode ? 'Konto registrieren' : 'Anmelden';

    document.getElementById('authSubmitBtn').textContent =
        isRegisterMode ? 'REGISTRIEREN' : 'EINLOGGEN';

    document.getElementById('authSwitchBtn').textContent =
        isRegisterMode
            ? 'Bereits ein Konto? Hier anmelden'
            : 'Noch kein Konto? Hier registrieren';
}

async function handleCustomerAuth(event) {
    event.preventDefault();

    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value.trim();

    const endpoint = isRegisterMode
        ? '/api/customer/register'
        : '/api/customer/login';

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Fehler');
        }

        currentCustomer = data.customer;

        if (currentCustomer.hasHausverbot) {
            showToast('⚠️ Achtung: Für dieses Konto besteht ein Hausverbot!');
        }

        sessionStorage.setItem(
            'soulSushiCustomer',
            JSON.stringify(currentCustomer)
        );

        try { sessionStorage.setItem('soulSushiPw', password); } catch (e) {}

        closeCustomerAuthModal();
        updateCustomerNavUI();

        showToast(`🎉 Willkommen, ${currentCustomer.username}!`);

    } catch (err) {
        const errEl = document.getElementById('authErrorMsg');

        if (errEl) {
            errEl.textContent = err.message;
            errEl.style.display = 'block';
        }
    }
}

function customerLogout() {
    currentCustomer = null;

    sessionStorage.removeItem('soulSushiCustomer');

    try { sessionStorage.removeItem('soulSushiPw'); } catch (e) {}

    closeCustomerAuthModal();
    updateCustomerNavUI();

    showToast('Erfolgreich abgemeldet');
}

function updateCustomerNavUI() {
    const btn = document.getElementById('customerNavBtn');

    if (btn) {
        if (currentCustomer) {
            const label = currentCustomer.hasHausverbot
                ? '🚫 (Hausverbot)'
                : (
                    currentCustomer.vipStatus &&
                    currentCustomer.vipStatus !== 'Kein'
                        ? currentCustomer.vipStatus
                        : 'Kunde'
                );

            btn.textContent =
                `👤 ${currentCustomer.username} (${label})`;

            btn.style.borderColor = currentCustomer.hasHausverbot
                ? '#c82333'
                : '#2ecc71';

            btn.style.color = currentCustomer.hasHausverbot
                ? '#c82333'
                : '#2ecc71';

        } else {
            btn.textContent = '🔑 Kunden-Login';
            btn.style.borderColor = '';
            btn.style.color = '';
        }
    }
}

function showToast(msg) {
    const t = document.getElementById('toast');

    if (!t) return;

    t.textContent = msg;
    t.style.display = 'block';

    setTimeout(() => {
        t.style.display = 'none';
    }, 3500);
}


// Termine

function customerPw() {
    try { return sessionStorage.getItem('soulSushiPw') || ''; } catch (e) { return ''; }
}

function escHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function openAppointmentModal(event) {
    if (event) event.preventDefault();

    if (!currentCustomer) {
        showToast('🔑 Bitte logge dich zuerst ein, um einen Termin zu vereinbaren.');
        openCustomerAuthModal();
        return;
    }

    if (currentCustomer.hasHausverbot) {
        showToast('❌ Du hast Hausverbot und kannst keine Termine anfragen.');
        return;
    }

    const nameEl = document.getElementById('apptName');
    if (nameEl && !nameEl.value && currentCustomer) nameEl.value = currentCustomer.username;

    document.getElementById('appointmentModal').classList.add('open');
}

function closeAppointmentModal() {
    document.getElementById('appointmentModal').classList.remove('open');
}

async function submitAppointment(event) {
    event.preventDefault();

    const body = {
        name: document.getElementById('apptName').value.trim(),
        concern: document.getElementById('apptConcern').value.trim(),
        date: document.getElementById('apptDateInput').dataset.iso || '',
        time: document.getElementById('apptTimeInput').value,
        phone: document.getElementById('apptPhone').value.trim()
    };

    if (!currentCustomer) {
        closeAppointmentModal();
        showToast('🔑 Bitte logge dich zuerst ein.');
        openCustomerAuthModal();
        return;
    }

    body.username = currentCustomer.username;
    body.password = customerPw();

    try {
        const res = await fetch('/api/appointments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Fehler');

        closeAppointmentModal();
        event.target.reset();
        if (window.resetDatePick) window.resetDatePick('apptDateInput');

        showToast('📅 Termin angefragt – Status siehst du in deinem Kundenkonto.');
    } catch (err) {
        showToast('❌ ' + err.message);
    }
}

async function loadMyAppointments() {
    const box = document.getElementById('profileAppointments');
    if (!box || !currentCustomer) return;

    box.innerHTML = '<p style="color:#888; font-size:13px;">Lade …</p>';

    try {
        const res = await fetch('/api/appointments/mine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentCustomer.username, password: customerPw() })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Fehler');

        const colors = { 'In Bearbeitung': '#a3a2b0', 'Akzeptiert': '#86b99a', 'Abgelehnt': '#e8574a', 'Verschoben': '#f0b866' };
        const list = data.appointments || [];

        box.innerHTML = list.length === 0
            ? '<p style="color:#888; font-size:13px;">Noch keine Termine.</p>'
            : list.map(a => `
                <div style="background: rgba(241,233,218,.04); border: 1px solid rgba(241,233,218,.1); border-radius: 3px; padding: 10px 12px; margin-bottom: 8px; font-size: 13px;">
                    <div style="display:flex; justify-content:space-between; gap:10px;">
                        <strong>${escHtml(a.concern)}</strong>
                        <strong style="color:${colors[a.status] || '#aaa'}; white-space:nowrap;">${escHtml(a.status)}</strong>
                    </div>
                    <div style="color:#aaa; margin-top:4px;">${a.status === 'Verschoben'
                        ? `Verschoben auf <strong style="color:#f0b866;">📅 ${escHtml(fmtDate(a.date))} · 🕒 ${escHtml(a.time)}</strong><br>vorher: ${escHtml(fmtDate(a.origDate))} ${escHtml(a.origTime)}`
                        : `📅 ${escHtml(fmtDate(a.date))} · 🕒 ${escHtml(a.time)}`}</div>
                </div>
            `).join('');
    } catch (err) {
        box.innerHTML = `<p style="color:#c82333; font-size:13px;">${escHtml(err.message)}</p>`;
    }
}

function renderNewsAndJobs() {
    const news = (appState.news || []).slice().sort((a, b) =>
        (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const nSec = document.getElementById('news'), nGrid = document.getElementById('newsGrid');
    if (nSec && nGrid) {
        nSec.hidden = news.length === 0;
        const sig = JSON.stringify(news);
        if (nGrid.dataset.sig !== sig) {
            nGrid.dataset.sig = sig;
            nGrid.innerHTML = news.map(n => {
                const d = n.createdAt ? new Date(Number(n.createdAt)).toLocaleDateString('de-DE') : '';
                return `<article class="news-card${n.pinned ? ' pinned' : ''}">
                    <div class="news-meta">${n.pinned ? '📌 Angepinnt' : escHtml(d)}</div>
                    <h3>${escHtml(n.title)}</h3>
                    <p>${escHtml(n.text).replace(/\n/g, '<br>')}</p></article>`;
            }).join('');
        }
    }
    const open = !!(appState.status && appState.status.applicationsOpen);
    const banner = document.getElementById('applyBanner'), jGrid = document.getElementById('jobsGrid');
    const invite = String((appState.status && appState.status.discordInvite) || '').trim();
    const jobs = appState.jobs || [];
    if (banner) {
        banner.className = 'apply-banner ' + (open ? 'open' : 'closed');
        banner.innerHTML = open
            ? '<strong>Bewerbungsphase offen</strong><span>Wir suchen Verstärkung – bewirb dich jetzt.</span>'
            : '<strong>Bewerbungsphase geschlossen</strong><span>Aktuell nehmen wir keine Bewerbungen an. Schau bald wieder vorbei.</span>';
    }
    if (jGrid) {
        const sig = JSON.stringify([jobs, open, invite]);
        if (jGrid.dataset.sig === sig) return;
        jGrid.dataset.sig = sig;
        jGrid.innerHTML = jobs.length ? jobs.map(j => `<article class="job-card">
            <div class="news-meta">${escHtml(j.type || '')}</div>
            <h3>${escHtml(j.title)}</h3>
            ${j.description ? `<p>${escHtml(j.description).replace(/\n/g, '<br>')}</p>` : ''}
            ${j.requirements ? `<h4>Voraussetzungen</h4><p>${escHtml(j.requirements).replace(/\n/g, '<br>')}</p>` : ''}
            ${open
                ? (/^https?:\/\//.test(invite)
                    ? `<a class="btn-red" href="${escHtml(invite)}" target="_blank" rel="noopener">Jetzt bewerben</a>`
                    : '<span class="job-hint">Bewirb dich direkt im Spiel beim Team.</span>')
                : '<span class="job-hint">Bewerbung aktuell nicht möglich</span>'}
        </article>`).join('') : '<p class="job-hint">Derzeit sind keine Stellen ausgeschrieben.</p>';
    }
}

// 2026-11-17 -> 17.11.2026
function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[3] + '.' + m[2] + '.' + m[1] : String(iso || '');
}


// Raumplan der Reservierung

let resMapReady = false;
let takenReq = 0;

function initReservationMap() {
    if (resMapReady || !window.FloorPlan) return;
    const box = document.getElementById('resMap');
    if (!box) return;
    resMapReady = true;

    FloorPlan.init(box, function () {
        // Bereich folgt dem gewählten Tisch
        const type = document.getElementById('resType');
        const area = FloorPlan.areaOfSelection();
        if (type) {
            if (area) { type.value = area; type.disabled = true; }
            else { type.disabled = false; }
        }
    });

    ['resDate', 'resTime', 'resGuests'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', updateTakenTables);
            el.addEventListener('input', updateTakenTables);
        }
    });

    updateTakenTables();
}

async function updateTakenTables() {
    if (!window.FloorPlan) return;

    const date = document.getElementById('resDate').dataset.iso || '';
    const time = document.getElementById('resTime').value.trim();

    if (!date || !time) return FloorPlan.setTaken([], false);

    const mine = ++takenReq;

    try {
        const res = await fetch('/api/tables/taken', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, time })
        });
        const data = await res.json();

        if (mine !== takenReq) return; // neuere Anfrage läuft

        FloorPlan.setTaken(res.ok ? (data.taken || []) : [], true);
    } catch (err) {
        if (mine === takenReq) FloorPlan.setTaken([], true);
    }
}
