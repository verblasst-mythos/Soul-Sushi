let appState = null;
let cart = [];
let activeCategory = null;
let currentCustomer = null;
let isRegisterMode = false;
let selectedVipTier = '';

document.addEventListener('DOMContentLoaded', async () => {
    const savedCustomer = sessionStorage.getItem('soulSushiCustomer');
    if (savedCustomer) {
        currentCustomer = JSON.parse(savedCustomer);
        updateCustomerNavUI();
    }
    await fetchAppState();
    setInterval(fetchAppState, 5000);
});

async function fetchAppState() {
    try {
        const res = await fetch('/api/state');
        appState = await res.json();
        const discordAnchor = document.getElementById('discordInviteAnchor');
        if (discordAnchor) {
            const invite = appState && appState.status ? String(appState.status.discordInvite || '').trim() : '';
            if (invite && /^https:\/\/(discord\.gg|discord\.com\/invite)\//i.test(invite)) {
                discordAnchor.href = invite;
                discordAnchor.style.display = 'inline-block';
            } else {
                discordAnchor.removeAttribute('href');
                discordAnchor.style.display = 'none';
            }
        }
        
        if (currentCustomer && appState.customers) {
            const updated = appState.customers.find(c => String(c.id) === String(currentCustomer.id));
            if (updated) {
                currentCustomer = updated;
                sessionStorage.setItem('soulSushiCustomer', JSON.stringify(currentCustomer));
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
    if (badge) badge.className = isOpen ? 'status-badge open' : 'status-badge closed';
    if (statusText) statusText.textContent = isOpen ? 'GEÖFFNET' : 'GESCHLOSSEN';
    if (heroStatusSpan) heroStatusSpan.textContent = isOpen ? 'GEÖFFNET' : 'GESCHLOSSEN';

    const activeStaffCount = appState.staff.filter(s => s.onDuty).length;
    if (heroActiveStaff) heroActiveStaff.textContent = `${activeStaffCount} im Dienst`;
    if (heroWorkload) heroWorkload.textContent = appState.status.workload;

    renderMenu();
    renderTeam();
    updateCartCount();
}

function renderMenu() {
    const tabsContainer = document.getElementById('menuTabsContainer');
    const gridContainer = document.getElementById('menuGridContainer');
    if (!tabsContainer || !gridContainer) return;

    const categories = [...new Set(appState.menu.map(m => m.category))];
    if (!activeCategory && categories.length > 0) activeCategory = categories[0];

    tabsContainer.innerHTML = categories.map(cat => `
        <button type="button" class="btn-nav-outline ${cat === activeCategory ? 'active' : ''}" onclick="selectMenuCategory('${cat}')" style="${cat === activeCategory ? 'background:#c82333; border-color:#c82333;' : ''}">
            ${cat}
        </button>
    `).join('');

    const filteredDishes = appState.menu.filter(m => m.category === activeCategory);
    gridContainer.innerHTML = filteredDishes.map(d => `
        <div style="background:#141414; border:1px solid rgba(255,255,255,0.08); padding:20px; border-radius:8px; display:flex; flex-direction:column; justify-content:space-between;">
            <div>
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
                    <h4 style="font-family:'Cormorant Garamond',serif; font-size:22px; margin:0; color:#fff;">${d.name}</h4>
                    <strong style="color:#c82333; font-size:16px;">${d.price.toFixed(2).replace('.', ',')} €</strong>
                </div>
                <p style="color:#aaa; font-size:13px; line-height:1.5; margin:0 0 20px 0;">${d.desc || ''}</p>
            </div>
            <button type="button" class="btn-red full-width" onclick="addToCart(${d.id})">+ In den Warenkorb</button>
        </div>
    `).join('');
}

function selectMenuCategory(cat) {
    activeCategory = cat;
    renderMenu();
}

function renderTeam() {
    const teamContainer = document.getElementById('teamGridContainer');
    if (!teamContainer) return;

    teamContainer.innerHTML = appState.staff.map(s => `
        <div style="background:#141414; border:1px solid rgba(255,255,255,0.08); border-radius:8px; overflow:hidden; display:flex; flex-direction:column;">
            <div style="height:220px; overflow:hidden; position:relative;">
                <img src="${s.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80'}" alt="${s.name}" style="width:100%; height:100%; object-fit:cover;">
                <span style="position:absolute; top:10px; right:10px; background:${s.onDuty ? '#2ecc71' : '#555'}; color:#fff; font-size:10px; font-weight:700; padding:4px 8px; border-radius:12px;">
                    ${s.onDuty ? '🟢 IM DIENST' : '⚫ FREI'}
                </span>
            </div>
            <div style="padding:20px; display:flex; flex-direction:column; flex:1; justify-content:space-between;">
                <div>
                    <span style="color:#c82333; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; display:block; margin-bottom:5px;">${s.role}</span>
                    <h4 style="font-family:'Cormorant Garamond',serif; font-size:24px; margin:0; color:#fff;">${s.name}</h4>
                </div>
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
    const existing = cart.find(c => c.id === id);
    if (existing) existing.qty++;
    else cart.push({ ...item, qty: 1 });
    updateCartCount();
    showToast(`✅ ${item.name} zum Warenkorb hinzugefügt`);
}

function updateCartCount() {
    const count = cart.reduce((sum, i) => sum + i.qty, 0);
    const el = document.getElementById('cartCount');
    if (el) el.textContent = count;
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
                        <span style="color:#aaa; font-size:12px;">${i.qty}x ${i.price.toFixed(2)} €</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <strong>${(i.price * i.qty).toFixed(2)} €</strong>
                        <button type="button" onclick="removeFromCart(${i.id})" style="background:none; border:none; color:#c82333; cursor:pointer; font-weight:bold;">✕</button>
                    </div>
                </div>
            `;
        }).join('');

    let discountPercent = (currentCustomer && currentCustomer.discount) ? currentCustomer.discount : 0;
    let finalTotal = total * (1 - discountPercent / 100);

    if (discountPercent > 0) {
        totalEl.innerHTML = `<span style="text-decoration: line-through; color: #888; font-size: 13px; margin-right: 8px;">${total.toFixed(2).replace('.', ',')} €</span> ${finalTotal.toFixed(2).replace('.', ',')} € <small style="color: #2ecc71; font-size: 11px;">(${discountPercent}% VIP-Rabatt)</small>`;
    } else {
        totalEl.textContent = `${total.toFixed(2).replace('.', ',')} €`;
    }

    modal.classList.add('open');
}

function removeFromCart(id) {
    cart = cart.filter(i => i.id !== id);
    updateCartCount();
    openCartModal();
}

function closeCartModal() {
    const modal = document.getElementById('cartModal');
    if (modal) modal.classList.remove('open');
}

async function checkoutOrder() {
    if (currentCustomer && currentCustomer.hasHausverbot) return showToast('❌ Du hast Hausverbot.');
    if (cart.length === 0) return showToast('Warenkorb ist leer');
    let rawTotal = cart.reduce((sum, i) => sum + (i.price * i.qty), 0);
    let discountPercent = (currentCustomer && currentCustomer.discount) ? currentCustomer.discount : 0;
    let total = rawTotal * (1 - discountPercent / 100);
    
    await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            customer: currentCustomer ? currentCustomer.username : 'Online Kunde',
            table: 'Lieferung / Abholung',
            items: cart,
            total: total
        })
    });

    cart = [];
    updateCartCount();
    closeCartModal();
    showToast('🎉 Bestellung erfolgreich abgesendet!');
}

function openReservationModal() {
    if (currentCustomer && currentCustomer.hasHausverbot) return showToast('❌ Du hast Hausverbot.');
    const modal = document.getElementById('reservationModal');
    if (modal) modal.classList.add('open');
}

function closeReservationModal() {
    const modal = document.getElementById('reservationModal');
    if (modal) modal.classList.remove('open');
}

async function submitReservation(event) {
    event.preventDefault();
    if (currentCustomer && currentCustomer.hasHausverbot) return showToast('❌ Hausverbot');
    const name = document.getElementById('resName').value.trim();
    const guests = parseInt(document.getElementById('resGuests').value);
    const date = document.getElementById('resDate').value.trim();
    const time = document.getElementById('resTime').value.trim();
    const type = document.getElementById('resType').value;

    await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, guests, date, time, type })
    });

    closeReservationModal();
    showToast('📅 Reservierungsanfrage erfolgreich gesendet!');
    document.getElementById('resName').value = '';
}

// VIP Antrag Funktionen mit Diagnose-Log
function openVipApplyModal(tier) {
    console.log("VIP-Button geklickt für:", tier);
    
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
    
    if (titleEl) titleEl.textContent = `${tier} beantragen`;
    if (tierEl) tierEl.value = tier;
    
    if (modalEl) {
        modalEl.classList.add('open');
    } else {
        console.error("Fehler: #vipApplyModal wurde im HTML nicht gefunden!");
        showToast("❌ Fehler: Modal in HTML nicht gefunden.");
    }
}

function closeVipApplyModal() {
    const modalEl = document.getElementById('vipApplyModal');
    if (modalEl) modalEl.classList.remove('open');
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
        if (!res.ok) throw new Error('Fehler');

        closeVipApplyModal();
        showToast('🎉 VIP-Antrag erfolgreich eingereicht! Die Leitungsebene wurde informiert.');
        if (phoneInput) phoneInput.value = '';
    } catch (err) {
        showToast('❌ Fehler beim Einreichen.');
    }
}

// Kunden-Auth & Profil
function openCustomerAuthModal() {
    if (currentCustomer) {
        document.getElementById('profileUsernameTitle').textContent = `Konto: ${currentCustomer.username}`;
        document.getElementById('profileVipBadge').textContent = currentCustomer.vipStatus || 'Kein';
        document.getElementById('profileStammBadge').textContent = currentCustomer.isStammkunde ? 'Ja' : 'Nein';
        
        const hvBadge = document.getElementById('profileHausverbotBadge');
        if (currentCustomer.hasHausverbot) {
            hvBadge.textContent = 'JA (HAUSVERBOT AKTIV)';
            hvBadge.style.color = '#c82333';
        } else {
            hvBadge.textContent = 'Nein';
            hvBadge.style.color = '#2ecc71';
        }

        document.getElementById('profileDiscount').textContent = `${currentCustomer.discount || 0} %`;
        document.getElementById('customerProfileModal').classList.add('open');
    } else {
        document.getElementById('customerAuthModal').classList.add('open');
    }
}

function closeCustomerAuthModal() {
    const authModal = document.getElementById('customerAuthModal');
    const profileModal = document.getElementById('customerProfileModal');
    if (authModal) authModal.classList.remove('open');
    if (profileModal) profileModal.classList.remove('open');
}

function toggleAuthMode() {
    isRegisterMode = !isRegisterMode;
    document.getElementById('authModalTitle').textContent = isRegisterMode ? 'Konto registrieren' : 'Anmelden';
    document.getElementById('authSubmitBtn').textContent = isRegisterMode ? 'REGISTRIEREN' : 'EINLOGGEN';
    document.getElementById('authSwitchBtn').textContent = isRegisterMode ? 'Bereits ein Konto? Hier anmelden' : 'Noch kein Konto? Hier registrieren';
}

async function handleCustomerAuth(event) {
    event.preventDefault();
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value.trim();
    const endpoint = isRegisterMode ? '/api/customer/register' : '/api/customer/login';

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Fehler');

        currentCustomer = data.customer;
        if (currentCustomer.hasHausverbot) {
            showToast('⚠️ Achtung: Für dieses Konto besteht ein Hausverbot!');
        }

        sessionStorage.setItem('soulSushiCustomer', JSON.stringify(currentCustomer));
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
    closeCustomerAuthModal();
    updateCustomerNavUI();
    showToast('Erfolgreich abgemeldet');
}

function updateCustomerNavUI() {
    const btn = document.getElementById('customerNavBtn');
    if (btn) {
        if (currentCustomer) {
            let label = currentCustomer.hasHausverbot ? '🚫 (Hausverbot)' : (currentCustomer.vipStatus && currentCustomer.vipStatus !== 'Kein' ? currentCustomer.vipStatus : 'Kunde');
            btn.textContent = `👤 ${currentCustomer.username} (${label})`;
            btn.style.borderColor = currentCustomer.hasHausverbot ? '#c82333' : '#2ecc71';
            btn.style.color = currentCustomer.hasHausverbot ? '#c82333' : '#2ecc71';
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
    setTimeout(() => { t.style.display = 'none'; }, 3500);
}