// Plain ES5 on purpose: if the main bundle cannot run (very old browser or Android System
// WebView), explain what to do instead of leaving "Carregando…" on screen forever.
(function () {
  setTimeout(function () {
    if (window.__smaBooted) return;
    var app = document.getElementById('app');
    if (!app) return;
    while (app.firstChild) app.removeChild(app.firstChild);
    var box = document.createElement('main');
    box.className = 'boot-error';
    var h = document.createElement('h1');
    h.textContent = 'Este navegador é antigo demais para o SMA';
    var p = document.createElement('p');
    p.textContent = 'No Android, atualize o "Android System WebView" e o Chrome pela Play Store e abra o SMA de novo. No computador, use uma versão recente do Chrome, Edge, Firefox ou Safari.';
    box.appendChild(h);
    box.appendChild(p);
    app.appendChild(box);
  }, 8000);
})();
