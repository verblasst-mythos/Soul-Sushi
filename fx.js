/* Glut-Funken im Hero und Kopfzeile beim Scrollen. Aus bei "weniger Bewegung". */
(function () {
  var header = document.querySelector('.site-header');
  if (header) {
    var onScroll = function () { header.classList.toggle('scrolled', window.scrollY > 40); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  var box = document.getElementById('embers');
  if (!box || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  for (var i = 0; i < 16; i++) {
    var e = document.createElement('span');
    e.className = 'ember';
    e.style.left = (Math.random() * 100) + '%';
    e.style.setProperty('--dx', (Math.random() * 120 - 40) + 'px');
    e.style.animationDuration = (9 + Math.random() * 9) + 's';
    e.style.animationDelay = (-Math.random() * 14) + 's';
    var sz = 2 + Math.random() * 4;
    e.style.width = e.style.height = sz + 'px';
    box.appendChild(e);
  }
})();

/* Mini-Kalender für Felder mit Klasse .date-pick (Wert: input.dataset.iso = YYYY-MM-DD) */
(function () {
  var MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  var DOW = ['Mo','Di','Mi','Do','Fr','Sa','So'];
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var iso = function (y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); };

  function setup(input) {
    var cal = document.createElement('div');
    cal.className = 'mini-cal';
    cal.hidden = true;
    input.insertAdjacentElement('afterend', cal);
    var now = new Date();
    var todayIso = iso(now.getFullYear(), now.getMonth(), now.getDate());
    var view = { y: now.getFullYear(), m: now.getMonth() };

    function render() {
      var first = new Date(view.y, view.m, 1);
      var offset = (first.getDay() + 6) % 7;
      var days = new Date(view.y, view.m + 1, 0).getDate();
      var atMin = view.y === now.getFullYear() && view.m === now.getMonth();
      var h = '<div class="mc-head"><button type="button" class="mc-nav" data-d="-1" aria-label="Vorheriger Monat"' + (atMin ? ' disabled' : '') + '>‹</button>' +
        '<span>' + MONTHS[view.m] + ' ' + view.y + '</span>' +
        '<button type="button" class="mc-nav" data-d="1" aria-label="Nächster Monat">›</button></div><div class="mc-grid">';
      DOW.forEach(function (d) { h += '<span class="mc-dow">' + d + '</span>'; });
      for (var i = 0; i < offset; i++) h += '<span></span>';
      for (var d = 1; d <= days; d++) {
        var v = iso(view.y, view.m, d);
        var cls = 'mc-day' + (v === todayIso ? ' today' : '') + (v === input.dataset.iso ? ' sel' : '');
        h += '<button type="button" class="' + cls + '" data-v="' + v + '"' + (v < todayIso ? ' disabled' : '') + '>' + d + '</button>';
      }
      cal.innerHTML = h + '</div>';
    }

    cal.addEventListener('click', function (e) {
      var nav = e.target.closest('.mc-nav');
      if (nav && !nav.disabled) {
        view.m += +nav.dataset.d;
        if (view.m < 0) { view.m = 11; view.y--; }
        if (view.m > 11) { view.m = 0; view.y++; }
        render();
        return;
      }
      var day = e.target.closest('.mc-day');
      if (day && !day.disabled) {
        var p = day.dataset.v.split('-');
        input.dataset.iso = day.dataset.v;
        input.value = p[2] + '.' + p[1] + '.' + p[0];
        cal.hidden = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    function toggle() {
      if (cal.hidden) {
        if (input.dataset.iso) { var q = input.dataset.iso.split('-'); view.y = +q[0]; view.m = +q[1] - 1; }
        render();
      }
      cal.hidden = !cal.hidden;
    }
    input.addEventListener('click', toggle);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    input._cal = cal;
  }

  document.querySelectorAll('input.date-pick').forEach(setup);

  window.resetDatePick = function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value = '';
    delete el.dataset.iso;
    if (el._cal) el._cal.hidden = true;
  };
})();
