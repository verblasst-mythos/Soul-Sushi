/* Interaktiver Raumplan für die Reservierung.
   ACHTUNG: Tisch-IDs und Plätze müssen mit private.table_seats() in supabase_update_termine.sql übereinstimmen. */
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var TABLES = [];
  // 11 Lounge-Tische (je 4 Plätze): 6 an der Fensterfront, 5 gegenüber
  for (var n = 0; n < 11; n++) {
    var left = n < 6;
    TABLES.push({ id: 'N' + (n + 1), kind: 'nische', name: 'Lounge-Tisch ' + (n + 1), seats: 4, flip: !left,
      x: left ? 92 : 232, y: left ? 62 + n * 62 : 92 + (n - 6) * 62, area: 'Hauptraum' });
  }
  // 3 Tische (je 4 Sitze) auf dem Podest
  [95, 190, 285].forEach(function (y, i) { TABLES.push({ id: 'L' + (i + 1), kind: 'lang', name: 'Tisch ' + (i + 1), seats: 4, x: 395, y: y, area: 'Hauptraum' }); });
  // 15 Barhocker
  for (var i = 0; i < 15; i++) TABLES.push({ id: 'B' + (i + 1), kind: 'bar', name: 'Barhocker ' + (i + 1), seats: 1, x: 522, y: 76 + i * 22, area: 'Sushi Bar' });
  var BY_ID = {}; TABLES.forEach(function (t) { BY_ID[t.id] = t; });

  var state = { taken: [], selected: [], enabled: false };
  var root, svg, info, onChange;

  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function drawStatic() {
    el('rect', { x: 10, y: 10, width: 620, height: 420, rx: 4, fill: '#1a1410', stroke: 'rgba(241,233,218,.25)' }, svg);
    for (var y = 24; y < 420; y += 22) el('line', { x1: 14, x2: 626, y1: y, y2: y, stroke: 'rgba(216,120,60,.07)' }, svg);
    // Fensterfront
    el('rect', { x: 6, y: 20, width: 6, height: 400, fill: '#f0b866', opacity: .45 }, svg);
    var t = el('text', { x: 24, y: 220, class: 'fp-wall', transform: 'rotate(-90 24 220)', 'text-anchor': 'middle' }, svg); t.textContent = 'Fensterfront';
    // Aquarium
    el('rect', { x: 250, y: 16, width: 190, height: 22, rx: 3, fill: 'rgba(80,160,190,.28)', stroke: 'rgba(130,200,220,.5)' }, svg);
    t = el('text', { x: 345, y: 31, class: 'fp-wall', 'text-anchor': 'middle' }, svg); t.textContent = 'Aquarium';
    // Podest Langtische + Geländer
    el('rect', { x: 322, y: 50, width: 146, height: 300, rx: 3, fill: 'rgba(240,184,102,.05)', stroke: 'rgba(240,184,102,.4)', 'stroke-dasharray': '5 4' }, svg);
    el('line', { x1: 484, x2: 484, y1: 50, y2: 410, stroke: 'rgba(241,233,218,.35)', 'stroke-width': 2 }, svg);
    // Sushi-Bar-Theke
    el('rect', { x: 548, y: 56, width: 50, height: 350, rx: 4, fill: '#3a1c16', stroke: 'rgba(216,57,44,.6)' }, svg);
    t = el('text', { x: 573, y: 231, class: 'fp-wall', transform: 'rotate(90 573 231)', 'text-anchor': 'middle' }, svg); t.textContent = 'Sushi Bar';
    // Eingang
    el('rect', { x: 90, y: 426, width: 100, height: 8, fill: '#d8392c' }, svg);
    t = el('text', { x: 140, y: 421, class: 'fp-wall', 'text-anchor': 'middle' }, svg); t.textContent = 'Eingang';
  }

  function drawTable(tb) {
    var g = el('g', { class: 'fp-table', 'data-id': tb.id, role: 'button', tabindex: 0 }, svg);
    var cx = tb.x, cy = tb.y, label = cy;
    var f = tb.flip ? -1 : 1;
    if (tb.kind === 'nische') {
      el('path', { d: 'M ' + (cx - f * 34) + ' ' + (cy - 26) + ' A 32 32 0 0 ' + (f > 0 ? 0 : 1) + ' ' + (cx - f * 34) + ' ' + (cy + 26) + ' L ' + (cx - f * 22) + ' ' + (cy + 20) + ' A 21 21 0 0 ' + (f > 0 ? 1 : 0) + ' ' + (cx - f * 22) + ' ' + (cy - 20) + ' Z', fill: '#5a1f1c', stroke: 'rgba(241,233,218,.2)' }, g);
      el('circle', { cx: cx + f * 2, cy: cy, r: 19, class: 'fp-top' }, g);
    } else if (tb.kind === 'lang') {
      for (var k = 0; k < 2; k++) {
        el('rect', { x: cx - 38 + k * 48, y: cy - 31, width: 28, height: 7, rx: 2, fill: '#2a2230' }, g);
        el('rect', { x: cx - 38 + k * 48, y: cy + 24, width: 28, height: 7, rx: 2, fill: '#2a2230' }, g);
      }
      el('rect', { x: cx - 52, y: cy - 20, width: 104, height: 40, rx: 3, class: 'fp-top' }, g);
    } else {
      el('circle', { cx: cx, cy: cy, r: 9, class: 'fp-top' }, g);
    }
    var tx = el('text', { x: tb.kind === 'nische' ? cx + f * 2 : cx, y: label + (tb.kind === 'bar' ? 3 : -1), class: 'fp-id', 'text-anchor': 'middle' }, g);
    tx.textContent = tb.id;
    if (tb.kind !== 'bar') { var s = el('text', { x: tb.kind === 'nische' ? cx + f * 2 : cx, y: label + 10, class: 'fp-seats', 'text-anchor': 'middle' }, g); s.textContent = tb.seats + ' Pl.'; }
    var title = el('title', {}, g); title.textContent = tb.name + ' (' + tb.seats + ' ' + (tb.seats === 1 ? 'Platz' : 'Plätze') + ')';
    g.addEventListener('click', function () { pick(tb.id); });
    g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(tb.id); } });
  }

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
    state.selected = state.selected.filter(function (id) { var s = status(BY_ID[id]); return s === 'sel'; });
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

  window.FloorPlan = {
    init: function (container, cb) {
      root = container; onChange = cb;
      root.innerHTML = '';
      svg = el('svg', { viewBox: '0 0 640 440', class: 'fp-svg', role: 'group', 'aria-label': 'Raumplan' }, root);
      drawStatic(); TABLES.forEach(drawTable);
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
    reset: function () { state.selected = []; refresh(); }
  };
})();
