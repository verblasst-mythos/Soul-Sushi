/* Soul Sushi – Browser-Backend (nur GitHub Pages + Supabase, kein Server).
   Fängt alle fetch('/api/...')-Aufrufe ab und leitet sie an die gesicherten
   Supabase-Funktionen (api_*) weiter. Die Tabellen selbst sind von außen nicht lesbar;
   Passwörter/PINs liegen nur als Hash in der Datenbank. */
(function () {
  const CFG = window.SOUL_CONFIG;
  const realFetch = window.fetch.bind(window);
  const HEAD = { apikey: CFG.SUPABASE_KEY, 'Content-Type': 'application/json' };
  const TOKEN_KEY = 'soulStaffToken';
  const isStaffPage = /staff/i.test(location.pathname);

  const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch (e) { return null; } };
  const setToken = t => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} };

  async function rpc(name, args) {
    const r = await realFetch(CFG.SUPABASE_URL + '/rest/v1/rpc/' + name, {
      method: 'POST', headers: HEAD, body: JSON.stringify(args || {})
    });
    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { message: txt }; }
    if (!r.ok) throw new Error((data && (data.message || data.hint)) || ('Supabase-Fehler ' + r.status));
    return data;
  }

  const out = (data, ok) => new Response(JSON.stringify(data), { status: ok || 200, headers: { 'Content-Type': 'application/json' } });
  // Ergebnis der SQL-Funktion -> HTTP-Antwort (Fehler kommen als {error, status})
  const wrap = d => (d && d.error) ? out({ error: d.error }, d.status || 400) : out(d);

  // Mitarbeiter-Aktion (braucht Login-Token)
  const staff = (action, payload) => async () => {
    const token = getToken();
    if (!token) return out({ error: 'Nicht angemeldet' }, 401);
    const d = await rpc('api_staff_do', { p_token: token, p_action: action, p: payload() });
    if (d && d.status === 401) setToken(null);
    return wrap(d);
  };

  const routes = [];
  const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:id/g, '([^/]+)') + '$'), fn });

  route('GET', '/api/state', async () => {
    const token = getToken();
    if (token) {
      const d = await rpc('api_staff_state', { p_token: token });
      if (!(d && d.error)) return out(d);
      setToken(null); // Sitzung abgelaufen -> öffentliche Sicht
    }
    return out(await rpc('api_public_state'));
  });

  route('POST', '/api/staff/login', async (b) => {
    const d = await rpc('api_staff_login', { p_name: b.name, p_pin: b.pin });
    if (d && d.token) setToken(d.token);
    return wrap(d);
  });
  route('POST', '/api/staff/logout', async () => {
    const t = getToken(); setToken(null);
    if (t) await rpc('api_staff_logout', { p_token: t });
    return out({ success: true });
  });

  route('POST', '/api/customer/register', async b => wrap(await rpc('api_customer_register', { p_username: b.username, p_password: b.password })));
  route('POST', '/api/customer/login', async b => wrap(await rpc('api_customer_login', { p_username: b.username, p_password: b.password })));
  route('POST', '/api/vip/apply', async b => wrap(await rpc('api_vip_apply', { p_username: b.username, p_phone: b.phone, p_tier: b.tier })));

  // Kasse (Mitarbeiter) bzw. Online-Bestellung (Kunde)
  route('POST', '/api/orders', async b => isStaffPage && getToken() ? staff('order_create', () => b)() : wrap(await rpc('api_place_order', { p: b })));
  route('POST', '/api/reservations', async b => wrap(await rpc('api_place_reservation', { p: b })));

  route('POST', '/api/status', async b => staff('status', () => b)());
  route('POST', '/api/staff/toggle', async b => staff('toggle', () => ({ id: String(b.id) }))());
  route('POST', '/api/staff/add', async b => staff('staff_add', () => b)());
  route('PUT', '/api/staff/:id', async (b, [id]) => staff('staff_update', () => Object.assign({}, b, { id }))());
  route('DELETE', '/api/staff/:id', async (b, [id]) => staff('staff_delete', () => ({ id }))());
  route('POST', '/api/roles/add', async b => staff('role_add', () => b)());
  route('DELETE', '/api/roles/:id', async (b, [id]) => staff('role_delete', () => ({ id }))());
  route('POST', '/api/menu/add', async b => staff('menu_add', () => b)());
  route('PUT', '/api/menu/:id', async (b, [id]) => staff('menu_update', () => Object.assign({}, b, { id }))());
  route('DELETE', '/api/menu/:id', async (b, [id]) => staff('menu_delete', () => ({ id }))());
  route('POST', '/api/orders/:id/status', async (b, [id]) => staff('order_status', () => ({ id, status: b.status }))());
  route('DELETE', '/api/reservations/:id', async (b, [id]) => staff('reservation_delete', () => ({ id }))());
  route('POST', '/api/vip/applications/:id/action', async (b, [id]) => staff('vip_action', () => ({ id, action: b.action }))());
  route('PUT', '/api/admin/customer/:id', async (b, [id]) => staff('customer_update', () => Object.assign({}, b, { id }))());

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const m = url.match(/\/api\/[^?#]*/);
    if (!m || (/^https?:\/\//.test(url) && !url.startsWith(location.origin))) return realFetch(input, init);
    const path = m[0];
    const method = ((init && init.method) || 'GET').toUpperCase();
    let body = {};
    try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) {}
    for (const r of routes) {
      if (r.method !== method) continue;
      const mm = path.match(r.re);
      if (!mm) continue;
      return Promise.resolve().then(() => r.fn(body, mm.slice(1))).catch(err => {
        console.error(err);
        return out({ error: err.message }, 500);
      });
    }
    return Promise.resolve(out({ error: 'Unbekannte Route ' + path }, 404));
  };
})();
