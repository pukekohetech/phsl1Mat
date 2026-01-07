// sw.js – Offline-first PWA (SAFE VERSION)

const CACHE_NAME = "phs-safety-l1-v3";

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

// ---------------------------
// Install: cache core assets
// ---------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// ---------------------------
// Activate: delete old caches
// ---------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ---------------------------
// Fetch handler
// ---------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // ✅ Never intercept Google Fonts (prevents OTS / decode errors)
  if (
    url.hostname.includes("fonts.googleapis.com") ||
    url.hostname.includes("fonts.gstatic.com")
  ) {
    return; // let browser handle normally
  }

  // ✅ Navigation requests: network first, fallback to cached index.html
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // ✅ Only cache same-origin assets (your own files)
  if (url.origin !== self.location.origin) {
    return; // let browser handle normally
  }

  // ✅ Cache-first for same-origin static assets
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          // Only cache successful basic responses (avoid caching bad/opaque)
          if (!res || res.status !== 200 || res.type !== "basic") return res;

          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => {
          // No fallback for assets
          return new Response("", { status: 504, statusText: "Offline" });
        });
    })
  );
});
