// sw.js – Offline-first PWA
// Update cache name to force cache busting when assets change. 
// Bump the cache version whenever core assets change. This forces the
// service worker to re-cache updated files like script.js and questions.json.
const CACHE_NAME = 'phs-sfaety-l1';
const CORE_ASSETS = [
  './', './index.html', './script.js', './styles.css', './questions.json',
  './manifest.webmanifest', './icon-192.png', './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET' || !request.url.startsWith('http')) return;
  e.respondWith(caches.match(request).then(cached => {
    const network = fetch(request).then(r => {
      if (r && r.status === 200) caches.open(CACHE_NAME).then(c => c.put(request, r.clone()));
      return r;
    }).catch(() => cached || caches.match('./index.html'));
    return cached || network;
  }));
}); 
