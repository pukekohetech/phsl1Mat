
// sw.js – Offline-first PWA (SAFE + CLEAN)
// v7: cache local app assets and the approved PDF libraries for reliable offline export.

const CACHE_NAME = "phs-materials-l1-v9";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./script.js?v=15",
  "./styles.css?v=14",
  "./reading-comfort.js?v=2",
  "./resource.html",
  "./questions.json",
  "./questions-data.js?v=1",
  "./blank.jpg",
  "./woodq1.jpg",
  "./assessment.pdf",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
];

const OPTIONAL_PDF_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js",
  "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
];

// -------------------------------------
// Install: cache core assets and try to cache PDF libraries.
// -------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(CORE_ASSETS);
      // The app must still install if the school network blocks a CDN.
      await Promise.allSettled(OPTIONAL_PDF_ASSETS.map((url) => cache.add(url)));
    })
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

  // Cache only the three approved PDF libraries across origins. Other
  // cross-origin requests (fonts, unrelated CDNs, etc.) remain untouched.
  if (url.origin !== self.location.origin) {
    if (!OPTIONAL_PDF_ASSETS.includes(url.href)) return;

    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && (res.ok || res.type === "opaque")) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
          }
          return res;
        });
      })
    );
    return;
  }

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
