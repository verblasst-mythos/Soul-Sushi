/* Interaktiver Raumplan für die Reservierung – Grundriss nach Skizze (raumplan.png).
   Alle Koordinaten unten sind Skizzen-Koordinaten (Pixel der Skizze) und werden skaliert.
   ACHTUNG: Tisch-IDs und Plätze müssen mit private.table_seats() in supabase_update_termine.sql übereinstimmen.
   IDs bleiben unverändert: N1–N11 (Lounge), L1–L3 (Tische), B1–B15 (Barhocker; im Plan sind B1–B12 eingezeichnet). */
(function () {
  var NS = 'http://www.w3.org/2000/svg';

  // ---------- Skizze -> SVG-Koordinaten ----------
  var SCALE = 1.6, OX = 194, OY = 103, PAD = 22;
  function X(x) { return Math.round((x - OX) * SCALE + PAD); }
  function Y(y) { return Math.round((y - OY) * SCALE + PAD); }
  var W = X(537) + PAD, H = Y(525) + PAD;

  // ---------- Tische ----------
  var TABLES = [];
  // Lounge (linker Streifen): 11 Sitznischen mit je 4 Plätzen
  for (var n = 0; n < 11; n++) {
    TABLES.push({ id: 'N' + (n + 1), kind: 'nische', name: 'Lounge-Tisch ' + (n + 1), seats: 4,
      x: X(217), y: Y(135 + n * 36), area: 'Hauptraum' });
  }
  // Tischblock unter der Theke: 3 Tische mit je 4 Plätzen
  [333, 381, 429].forEach(function (y, i) {
    TABLES.push({ id: 'L' + (i + 1), kind: 'lang', name: 'Tisch ' + (i + 1), seats: 4,
      x: X(363), y: Y(y), area: 'Hauptraum' });
  });
  // Barhocker: 7 links der Theke (von oben nach unten), 5 unter der Theke (von links nach rechts)
  var STOOLS = [
    [378, 159], [378, 181], [378, 203], [378, 225], [378, 247], [378, 279], [378, 297],
    [400, 316], [425, 316], [452, 316], [481, 316], [511, 316]
  ];
  STOOLS.forEach(function (p, i) {
    TABLES.push({ id: 'B' + (i + 1), kind: 'bar', name: 'Barhocker ' + (i + 1), seats: 1,
      x: X(p[0]), y: Y(p[1]), area: 'Sushi Bar' });
  });
  var BY_ID = {}; TABLES.forEach(function (t) { BY_ID[t.id] = t; });

  var state = { taken: [], selected: [], enabled: false };
  var root, svg, info, onChange;

  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function label(parent, x, y, text, extra) {
    var a = { x: x, y: y, class: 'fp-wall', 'text-anchor': 'middle' };
    for (var k in extra || {}) a[k] = extra[k];
    var t = el('text', a, parent); t.textContent = text; return t;
  }

  // ---------- Raum zeichnen ----------
  function drawStatic(s) {
    // Außenwand (L-Form mit Eingangs-Ausschnitt unten rechts)
    var pts = [[194, 103], [537, 103], [537, 402], [465, 402], [465, 525], [194, 525]]
      .map(function (p) { return X(p[0]) + ',' + Y(p[1]); }).join(' ');
    el('polygon', { points: pts, fill: '#1a1410', stroke: 'rgba(241,233,218,.5)', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, s);
    // Lounge-Streifen
    el('rect', { x: X(194), y: Y(103), width: X(240) - X(194), height: Y(525) - Y(103), fill: 'rgba(240,184,102,.07)' }, s);
    el('line', { x1: X(240), x2: X(240), y1: Y(103), y2: Y(525), stroke: 'rgba(241,233,218,.5)', 'stroke-width': 2 }, s);
    label(s, (X(194) + X(240)) / 2, Y(103) + 17, 'Lounge');
    // Theke
    el('rect', { x: X(391), y: Y(149), width: X(536) - X(391), height: Y(305) - Y(149), rx: 3, fill: '#3a1c16', stroke: 'rgba(216,57,44,.65)', 'stroke-width': 1.5 }, s);
    label(s, (X(391) + X(536)) / 2, (Y(149) + Y(305)) / 2 + 4, 'Theke', { 'font-size': 14 });
    // Hocker-Reihe links der Theke (Rahmen) + Geländer
    el('rect', { x: X(340), y: Y(149), width: X(390) - X(340), height: Y(304) - Y(149), rx: 2, fill: 'none', stroke: 'rgba(216,57,44,.35)', 'stroke-dasharray': '4 3' }, s);
    el('line', { x1: X(390), x2: X(390), y1: Y(305), y2: Y(460), stroke: 'rgba(241,233,218,.45)', 'stroke-width': 2 }, s);
    // Tischblock
    el('rect', { x: X(341), y: Y(308), width: X(385) - X(341), height: Y(455) - Y(308), rx: 3, fill: 'rgba(240,184,102,.05)', stroke: 'rgba(240,184,102,.45)', 'stroke-dasharray': '5 4' }, s);
    // Eingang: Tür in der Wand zum Ausschnitt
    el('line', { x1: X(465), x2: X(465), y1: Y(418), y2: Y(498), stroke: '#d8392c', 'stroke-width': 5, 'stroke-linecap': 'round' }, s);
    label(s, X(501), Y(461) + 4, 'Eingang', { 'font-size': 13 });
  }

  function drawTable(s, tb, interactive) {
    var g = el('g', { class: 'fp-table', 'data-id': tb.id }, s);
    if (interactive) { g.setAttribute('role', 'button'); g.setAttribute('tabindex', 0); }
    var cx = tb.x, cy = tb.y;
    if (tb.kind === 'nische') {
      el('rect', { x: X(194) + 4, y: cy - 24, width: 9, height: 48, rx: 3, fill: '#5a1f1c', stroke: 'rgba(241,233,218,.2)' }, g);
      el('circle', { cx: cx + 4, cy: cy, r: 20, class: 'fp-top' }, g);
      el('text', { x: cx + 4, y: cy - 1, class: 'fp-id', 'text-anchor': 'middle' }, g).textContent = tb.id;
      el('text', { x: cx + 4, y: cy + 10, class: 'fp-seats', 'text-anchor': 'middle' }, g).textContent = '4 Pl.';
    } else if (tb.kind === 'lang') {
      [-14, 14].forEach(function (dy) {
        el('rect', { x: cx - 33, y: cy + dy - 8, width: 7, height: 16, rx: 2, fill: '#2a2230' }, g);
        el('rect', { x: cx + 26, y: cy + dy - 8, width: 7, height: 16, rx: 2, fill: '#2a2230' }, g);
      });
      el('rect', { x: cx - 22, y: cy - 25, width: 44, height: 50, rx: 3, class: 'fp-top' }, g);
      el('text', { x: cx, y: cy - 1, class: 'fp-id', 'text-anchor': 'middle' }, g).textContent = tb.id;
      el('text', { x: cx, y: cy + 11, class: 'fp-seats', 'text-anchor': 'middle' }, g).textContent = '4 Pl.';
    } else {
      if (interactive) el('circle', { cx: cx, cy: cy, r: 17, fill: 'transparent', class: 'fp-hit' }, g); // größere Trefferfläche
      el('circle', { cx: cx, cy: cy, r: 12, class: 'fp-top' }, g);
      el('text', { x: cx, y: cy + 3, class: 'fp-id fp-bid', 'text-anchor': 'middle' }, g).textContent = tb.id;
    }
    if (interactive) {
      el('title', {}, g).textContent = tb.name + ' (' + tb.seats + ' ' + (tb.seats === 1 ? 'Platz' : 'Plätze') + ')';
      g.addEventListener('click', function () { pick(tb.id); });
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(tb.id); } });
    }
    return g;
  }

  // ---------- Auswahl-Logik ----------
  function guests() { return parseInt((document.getElementById('resGuests') || {}).value, 10) || 1; }

  function status(tb) {
    if (state.taken.indexOf(tb.id) >= 0) return 'taken';
    if (state.selected.indexOf(tb.id) >= 0) return 'sel';
    if (tb.kind !== 'bar' && tb.seats < guests()) return 'small';
    return 'free';
  }

  function capacity() { return state.selected.reduce(function (n, id) { return n + BY_ID[id].seats; }, 0); }

  function pick(id) {
    if (!state.enabled) return;
    var tb = BY_ID[id], st = status(tb);
    if (st === 'taken' || st === 'small') return;
    var i = state.selected.indexOf(id);
    if (i >= 0) state.selected.splice(i, 1);
    else if (tb.kind === 'bar') state.selected = state.selected.filter(function (x) { return BY_ID[x].kind === 'bar'; }).concat(id);
    else state.selected = [id];
    refresh();
    if (onChange) onChange(state.selected.slice());
  }

  function refresh() {
    // Auswahl bereinigen, falls Tisch inzwischen belegt/zu klein
    state.selected = state.selected.filter(function (id) { return status(BY_ID[id]) === 'sel'; });
    svg.querySelectorAll('.fp-table').forEach(function (g) {
      var tb = BY_ID[g.getAttribute('data-id')], st = status(tb);
      g.setAttribute('class', 'fp-table fp-' + st + (state.enabled ? '' : ' fp-off'));
      g.setAttribute('aria-pressed', st === 'sel');
      g.setAttribute('aria-disabled', st === 'taken' || st === 'small' || !state.enabled);
    });
    if (!state.enabled) { info.textContent = 'Wähle zuerst Datum und Uhrzeit, dann siehst du, welche Tische frei sind.'; return; }
    if (!state.selected.length) { info.textContent = 'Tippe einen freien Tisch an. Ohne Wahl weisen wir dir einen Platz zu.'; return; }
    var names = state.selected.map(function (id) { return BY_ID[id].name; }).join(', ');
    var cap = capacity(), g = guests();
    info.textContent = 'Gewählt: ' + names + ' (' + cap + ' ' + (cap === 1 ? 'Platz' : 'Plätze') + ')' + (cap < g ? ' – noch ' + (g - cap) + ' Hocker nötig.' : '');
  }

  // ---------- Statische Darstellung (Mitarbeiteransicht): reservierte Tische rot ----------
  var STATIC_CSS =
    '.fp-static .fp-wall{fill:#b9a89a;font:11px sans-serif}' +
    '.fp-static .fp-top{fill:#3b2f28;stroke:#98877b;stroke-width:1.5}' +
    '.fp-static .fp-id{fill:#f1e9da;font:700 11px sans-serif}' +
    '.fp-static .fp-bid{font-size:8px}' +
    '.fp-static .fp-seats{fill:#c9b9ad;font:9px sans-serif}' +
    '.fp-static .fp-sel .fp-top{fill:#d8392c;stroke:#ffd2cc;stroke-width:2.5}';

  function staticSvg(selected) {
    var sel = {}; (selected || []).forEach(function (id) { sel[String(id).trim()] = true; });
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    s.setAttribute('class', 'fp-static');
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', 'Raumplan mit markierten reservierten Tischen');
    s.setAttribute('style', 'display:block;height:300px;width:auto;max-width:100%;margin:0 auto');
    el('style', {}, s).textContent = STATIC_CSS;
    drawStatic(s);
    TABLES.forEach(function (tb) {
      var g = drawTable(s, tb, false);
      g.setAttribute('class', 'fp-table' + (sel[tb.id] ? ' fp-sel' : ''));
    });
    return s.outerHTML;
  }

  window.FloorPlan = {
    init: function (container, cb) {
      root = container; onChange = cb;
      root.innerHTML = '';
      svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'fp-svg', role: 'group', 'aria-label': 'Raumplan' }, root);
      drawStatic(svg); TABLES.forEach(function (tb) { drawTable(svg, tb, true); });
      info = document.createElement('p'); info.className = 'fp-info'; info.setAttribute('aria-live', 'polite'); root.appendChild(info);
      var legend = document.createElement('div'); legend.className = 'fp-legend';
      legend.innerHTML = '<span><i class="free"></i>Frei</span><span><i class="sel"></i>Gewählt</span><span><i class="taken"></i>Belegt</span><span><i class="small"></i>Zu klein</span>';
      root.appendChild(legend);
      refresh();
    },
    setTaken: function (list, enabled) { state.taken = list || []; state.enabled = !!enabled; refresh(); if (onChange) onChange(state.selected.slice()); },
    refresh: refresh,
    selected: function () { return state.selected.slice(); },
    areaOfSelection: function () { return state.selected.length ? BY_ID[state.selected[0]].area : null; },
    reset: function () { state.selected = []; refresh(); },
    staticSvg: staticSvg
  };
})();
