// sw.js – Offline-first PWA (SAFE VERSION)
const CACHE_NAME = "phs-safety-l1-v2";

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

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET
  if (req.method !== "GET") return;

  // ✅ Do NOT intercept Google Fonts (prevents font decode / OTS errors)
  if (url.hostname.includes("fonts.googleapis.com") || url.hostname.includes("fonts.gstatic.com")) {
    return;
  }

  // ✅ Navigation requests (page loads) get index.html fallback
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // ✅ Static assets: cache-first, then network
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          // Only cache "ok" responses (avoid caching opaque / error responses)
          if (!res || res.status !== 200 || res.type === "opaque") return res;

          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => {
          // ❌ NO index.html fallback for assets!
          return undefined;
        });
    })
  );
});
