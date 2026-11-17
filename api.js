/* Soul Sushi – Backend im Browser (nur GitHub Pages + Supabase, kein Server).
   Fängt alle fetch('/api/...')-Aufrufe ab und führt die Logik direkt gegen Supabase aus.
   Gespeichert wird der gesamte Zustand als JSON in der Tabelle app_state (id = 'main'). */
(function () {
  const CFG = window.SOUL_CONFIG;
  const realFetch = window.fetch.bind(window);
  const TABLE = CFG.SUPABASE_URL + '/rest/v1/app_state';
  const H = { apikey: CFG.SUPABASE_KEY, 'Content-Type': 'application/json' };

  const OWNER = { id: 1794860000001, name: 'Owner', role: 'Geschäftsführung', pin: '0903',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80', onDuty: false, clockIn: '-' };
  const DEFAULTS = () => ({
    status: { isOpen: true, workload: 'Niedrig', discordWebhook: '' },
    roles: [{ id: 1, name: 'Geschäftsführung', isManagement: true, color: '#d4af37' }],
    staff: [OWNER], menu: [], orders: [], reservations: [], customers: [], vipApplications: []
  });

  async function readDB() {
    const r = await realFetch(TABLE + '?id=eq.main&select=data', { headers: H });
    if (!r.ok) throw new Error('Supabase Lesefehler (' + r.status + '): ' + (await r.text()));
    const rows = await r.json();
    let db = rows[0] && rows[0].data;
    if (!db || !Object.keys(db).length) db = DEFAULTS();
    const d = DEFAULTS();
    for (const k of Object.keys(d)) if (!db[k]) db[k] = d[k];
    if (!db.staff.some(s => String(s.name).toLowerCase() === 'owner')) db.staff.push(OWNER);
    return db;
  }
  async function writeDB(db) {
    const r = await realFetch(TABLE, {
      method: 'POST',
      headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, H),
      body: JSON.stringify({ id: 'main', data: db })
    });
    if (!r.ok) throw new Error('Supabase Schreibfehler (' + r.status + '): ' + (await r.text()));
  }

  const sid = (a, b) => String(a) === String(b);
  const discount = t => ({ 'Silver VIP': 5, 'Gold VIP': 10, 'Black VIP': 15 })[t] || 0;
  const hhmm = () => new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  // Jede Route bekommt (db, body, params) und gibt { res, save } zurück
  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:id/g, '([^/]+)') + '$'), fn });

  route('GET', '/api/state', db => ({ res: db }));
  route('POST', '/api/status', (db, b) => { db.status = Object.assign({}, db.status, b); return { res: db.status, save: true }; });

  route('POST', '/api/customer/register', (db, b) => {
    if (!b.username || !b.password) return { status: 400, res: { error: 'Benutzername und Passwort erforderlich' } };
    if (db.customers.find(c => c.username.toLowerCase() === b.username.toLowerCase())) return { status: 400, res: { error: 'Benutzername bereits vergeben' } };
    const c = { id: Date.now(), username: b.username, password: b.password, vipStatus: 'Kein', isStammkunde: false, hasHausverbot: false, discount: 0 };
    db.customers.push(c);
    return { res: { success: true, customer: c }, save: true };
  });
  route('POST', '/api/customer/login', (db, b) => {
    const c = db.customers.find(x => x.username.toLowerCase() === String(b.username || '').toLowerCase() && x.password === b.password);
    return c ? { res: { success: true, customer: c } } : { status: 401, res: { error: 'Ungültiger Benutzername oder Passwort' } };
  });

  route('POST', '/api/vip/apply', (db, b) => {
    if (!b.username || !b.phone || !b.tier) return { status: 400, res: { error: 'Fehlende Angaben' } };
    const a = { id: String(Date.now()), username: b.username, phone: b.phone, tier: b.tier, status: 'Ausstehend', timestamp: Date.now() };
    db.vipApplications.unshift(a);
    return { res: { success: true, application: a }, save: true };
  });
  route('POST', '/api/vip/applications/:id/action', (db, b, [id]) => {
    const a = db.vipApplications.find(x => sid(x.id, id));
    if (a) {
      a.status = b.action;
      if (b.action === 'Akzeptiert') {
        const c = db.customers.find(x => x.username.toLowerCase() === a.username.toLowerCase());
        if (c) { c.vipStatus = a.tier; c.discount = discount(a.tier); }
      }
    }
    return { res: db.vipApplications, save: !!a };
  });
  route('PUT', '/api/admin/customer/:id', (db, b, [id]) => {
    const c = db.customers.find(x => sid(x.id, id));
    if (c) {
      c.vipStatus = b.vipStatus ?? c.vipStatus;
      c.isStammkunde = b.isStammkunde ?? c.isStammkunde;
      c.hasHausverbot = b.hasHausverbot ?? c.hasHausverbot;
      c.discount = discount(c.vipStatus);
    }
    return { res: db.customers, save: !!c };
  });

  route('POST', '/api/roles/add', (db, b) => {
    db.roles.push({ id: Date.now(), name: b.name, isManagement: Boolean(b.isManagement), color: b.color || '#c82333' });
    return { res: db.roles, save: true };
  });
  route('DELETE', '/api/roles/:id', (db, b, [id]) => { db.roles = db.roles.filter(r => !sid(r.id, id)); return { res: db.roles, save: true }; });

  route('POST', '/api/staff/toggle', (db, b) => {
    const m = db.staff.find(s => sid(s.id, b.id));
    if (m) { m.onDuty = !m.onDuty; m.clockIn = m.onDuty ? hhmm() : '-'; }
    return { res: db.staff, save: !!m };
  });
  route('POST', '/api/staff/add', (db, b) => {
    db.staff.push({ id: Date.now(), name: b.name, role: b.role, pin: b.pin || '1234',
      avatar: b.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80', onDuty: false, clockIn: '-' });
    return { res: db.staff, save: true };
  });
  route('PUT', '/api/staff/:id', (db, b, [id]) => {
    const m = db.staff.find(s => sid(s.id, id));
    if (m) { m.name = b.name ?? m.name; m.role = b.role ?? m.role; m.pin = b.pin ?? m.pin; m.avatar = b.avatar ?? m.avatar; }
    return { res: db.staff, save: !!m };
  });
  route('DELETE', '/api/staff/:id', (db, b, [id]) => { db.staff = db.staff.filter(s => !sid(s.id, id)); return { res: db.staff, save: true }; });

  route('POST', '/api/menu/add', (db, b) => {
    db.menu.push({ id: Date.now(), category: b.category, name: b.name, desc: b.desc, price: parseFloat(b.price) });
    return { res: db.menu, save: true };
  });
  route('PUT', '/api/menu/:id', (db, b, [id]) => {
    const d = db.menu.find(m => sid(m.id, id));
    if (d) {
      d.name = b.name ?? d.name; d.category = b.category ?? d.category;
      d.price = b.price !== undefined ? parseFloat(b.price) : d.price; d.desc = b.desc ?? d.desc;
    }
    return { res: db.menu, save: !!d };
  });
  route('DELETE', '/api/menu/:id', (db, b, [id]) => { db.menu = db.menu.filter(m => !sid(m.id, id)); return { res: db.menu, save: true }; });

  route('POST', '/api/orders', (db, b) => {
    const o = { id: Math.floor(1000 + Math.random() * 9000), staffId: b.staffId ? parseInt(b.staffId) : null,
      customer: b.customer || 'Tisch / Laufkunde', table: b.table || 'Abholung', items: b.items, total: b.total,
      status: 'In Zubereitung', time: hhmm(), timestamp: Date.now() };
    db.orders.unshift(o);
    return { res: o, save: true };
  });
  route('POST', '/api/orders/:id/status', (db, b, [id]) => {
    const o = db.orders.find(x => sid(x.id, id));
    if (o) o.status = b.status;
    return { res: db.orders, save: !!o };
  });
  route('POST', '/api/reservations', (db, b) => {
    const r = Object.assign({ id: String(Date.now()) }, b, { status: 'Bestätigt' });
    db.reservations.unshift(r);
    return { res: r, save: true };
  });
  route('DELETE', '/api/reservations/:id', (db, b, [id]) => { db.reservations = db.reservations.filter(r => !sid(r.id, id)); return { res: db.reservations, save: true }; });

  const json = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });

  // Schreibzugriffe nacheinander abarbeiten, damit sich schnelle Klicks nicht überschreiben
  let queue = Promise.resolve();

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const m = url.match(/\/api\/[^?#]*/);
    if (!m || /^https?:\/\//.test(url) && !url.startsWith(location.origin)) return realFetch(input, init);
    const path = m[0];
    const method = ((init && init.method) || 'GET').toUpperCase();
    let body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
    for (const r of routes) {
      if (r.method !== method) continue;
      const mm = path.match(r.re);
      if (!mm) continue;
      const run = async () => {
        try {
          const db = await readDB();
          const out = r.fn(db, body, mm.slice(1));
          if (out.save) await writeDB(db);
          return json(out.res, out.status);
        } catch (err) {
          console.error(err);
          return json({ error: err.message }, 500);
        }
      };
      if (method === 'GET') return run();
      const p = queue.then(run, run);
      queue = p.catch(() => {});
      return p;
    }
    return Promise.resolve(json({ error: 'Unbekannte Route ' + path }, 404));
  };
})();
