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
