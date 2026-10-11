/* SlipFit service worker: lets the app open with no signal in the gym.
 * CACHE carries the app version; a new release installs a new cache and the
 * old one is deleted on activate. Bump it with changelog.js and the ?v= strings. */
const CACHE = 'slipfit-1.0.1';
const V = '?v=1.0.1-r3';
const SHELL = [
  './', 'index.html', 'app.css' + V, 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/changelog.js' + V, 'js/exercises.js' + V, 'js/calc.js' + V, 'js/programs.js' + V, 'js/gamify.js' + V,
  'js/store.js' + V, 'js/ui.js' + V, 'js/charts.js' + V, 'js/app.js' + V,
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('slipfit-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // account API, deck: always live
  if (req.mode === 'navigate') {
    // Network first for the page so a release shows up on the next load;
    // the cached copy is the offline fallback.
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put('index.html', copy));
      return res;
    }).catch(() => caches.match('index.html')));
    return;
  }
  // Versioned assets never change under the same URL: cache first.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./#/today');
  }));
});
