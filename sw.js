
// sw.js – Offline-first PWA (SAFE + CLEAN)
// v3: cache ONLY local core assets, never intercept fonts/CDNs, no cache poisoning.

const CACHE_NAME = "phs-safety-l1-v6";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./script.js",
  "./styles.css",
  "./questions.json",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

// -------------------------------------
// Install: cache core local assets only
// -------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// -------------------------------------
// Activate: delete older caches
// -------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// -------------------------------------
// Fetch: only handle same-origin GET
// - Navigation: network-first, fallback to cached index.html
// - Assets: stale-while-revalidate (cache-first + background update)
// -------------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only GET requests
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // ✅ Never touch cross-origin (fonts, cdnjs, etc.)
  if (url.origin !== self.location.origin) return;

  // ✅ Navigation (page load): network first, fallback offline
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Update cached index.html if fetch succeeds
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // ✅ Assets: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          // Only cache good responses (avoid caching error pages)
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached); // if offline, use cached

      // If cached exists, return it immediately, update in background
      return cached || networkFetch;
    })
  );
});
