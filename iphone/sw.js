// Garde l'app (pas les vidéos ni les addons) pour qu'elle s'ouvre tout de suite, même sans réseau.
// build.sh remplace 1.0.1-1793451606 : à chaque nouvelle version, l'iPhone télécharge les nouveaux fichiers.
const V = 'ofa-iphone-1.0.1-1793451606';
const SHELL = ['./', 'index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icons/icon-180.png',
  'fonts/pjs-400.woff2', 'fonts/pjs-500.woff2', 'fonts/pjs-700.woff2', 'fonts/pjs-800.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // Réseau d'abord (mises à jour immédiates), copie locale si l'iPhone est hors ligne.
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
