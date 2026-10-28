/* Gooners — service worker: funcionamento offline e carregamento rápido */
const VERSION = 'gooners-dedfa4e3a7362c7b94683943';
const CORE = ['./', 'assets/css/gooners.css', 'assets/js/tools.js', 'assets/js/app.js', 'assets/icons.svg', 'assets/img/icon.svg', 'manifest.webmanifest'];
const CDN = /^https:\/\/(cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)\//;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  const same = url.origin === location.origin;
  if (!same && !CDN.test(req.url)) return; // APIs externas (CEP, CNPJ, moedas, notícias) sempre online
  const fresh = req.mode === 'navigate' || /\.(json|xml|html)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (same && fresh) {
    // rede primeiro (conteúdo e notícias atualizados), cache como reserva offline
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); } return r; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./'))));
    return;
  }
  // stale-while-revalidate para CSS, JS, ícones, fontes e bibliotecas
  e.respondWith(caches.match(req, { ignoreSearch: same }).then((cached) => {
    const net = fetch(req).then((r) => { if (r.ok || r.type === 'opaque') { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); } return r; }).catch(() => cached);
    return cached || net;
  }));
});
