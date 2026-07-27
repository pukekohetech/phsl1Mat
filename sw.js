
// sw.js – Offline-first PWA (SAFE + CLEAN)
// v3: cache ONLY local core assets, never intercept fonts/CDNs, no cache poisoning.

const CACHE_NAME = "phs-safety-l1-v6";


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

// Files that should always be checked online first.
// These are the files most likely to change when the program is updated.
const NETWORK_FIRST_FILES = new Set([
  "",
  "index.html",
  "script.js",
  "styles.css",
  "reading-comfort.js",
  "resource.html",
  "questions.json",
  "questions-data.js",
  "manifest.webmanifest",
]);

// -------------------------------------
// Helper: remove query strings when checking a filename.
// Example: script.js?v=15 becomes script.js
// -------------------------------------
function getFileName(url) {
  const pathname = new URL(url).pathname;
  return pathname.substring(pathname.lastIndexOf("/") + 1);
}

// -------------------------------------
// Helper: safely place a response in the cache.
// -------------------------------------
async function cacheResponse(request, response) {
  if (!response) return;

  const canCache =
    response.ok ||
    response.type === "basic" ||
    response.type === "cors" ||
    response.type === "opaque";

  if (!canCache) return;

  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

// -------------------------------------
// Install:
// Cache the local application files.
// PDF libraries remain optional so a blocked CDN
// does not prevent the application from installing.
// -------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Core files are required.
      await cache.addAll(CORE_ASSETS);

      // External PDF libraries are optional.
      await Promise.allSettled(
        OPTIONAL_PDF_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url, {
              cache: "no-store",
            });

            if (response.ok || response.type === "opaque") {
              await cache.put(url, response.clone());
            }
          } catch (error) {
            console.warn("Optional PDF library could not be cached:", url);
          }
        })
      );
    })()
  );

  // Activate this service worker without waiting
  // for all existing tabs to be closed.
  self.skipWaiting();
});

// -------------------------------------
// Message:
// Allows the page to request immediate activation
// when a newer service worker is detected.
// -------------------------------------
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// -------------------------------------
// Activate:
// Delete previous application caches and take
// control of currently open pages.
// -------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();

      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      );

      await self.clients.claim();
    })()
  );
});

// -------------------------------------
// Fetch strategies
// -------------------------------------

// Network-first:
// 1. Try the newest server file.
// 2. Update the cached copy.
// 3. Use the cached copy if offline.
async function networkFirst(request, fallbackRequest = request) {
  try {
    const response = await fetch(request, {
      cache: "no-store",
    });

    if (response && response.ok) {
      await cacheResponse(request, response);
    }

    return response;
  } catch (error) {
    const cachedResponse =
      (await caches.match(request)) ||
      (await caches.match(fallbackRequest));

    if (cachedResponse) {
      return cachedResponse;
    }

    throw error;
  }
}

// Cache-first with background update:
// 1. Return the cached file immediately when available.
// 2. Check for a newer version in the background.
// 3. Use the network response if no cached file exists.
async function cacheFirstWithUpdate(event) {
  const request = event.request;
  const cachedResponse = await caches.match(request);

  const networkPromise = fetch(request, {
    cache: "no-store",
  })
    .then(async (response) => {
      if (response && response.ok) {
        await cacheResponse(request, response);
      }

      return response;
    })
    .catch(() => null);

  if (cachedResponse) {
    event.waitUntil(networkPromise);
    return cachedResponse;
  }

  const networkResponse = await networkPromise;

  if (networkResponse) {
    return networkResponse;
  }

  throw new Error(`File unavailable: ${request.url}`);
}

// -------------------------------------
// Fetch:
// - Navigations: network-first.
// - Critical program files: network-first.
// - Images, PDFs and other static files:
//   cache-first with background update.
// - Approved external PDF libraries:
//   cache-first with background update.
// -------------------------------------
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Service workers should only handle GET requests.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // -------------------------------------
  // Approved external PDF libraries
  // -------------------------------------
  if (url.origin !== self.location.origin) {
    if (!OPTIONAL_PDF_ASSETS.includes(url.href)) return;

    event.respondWith(cacheFirstWithUpdate(event));
    return;
  }

  // -------------------------------------
  // Page navigation
  // -------------------------------------
  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, "./index.html").catch(async () => {
        return (
          (await caches.match("./index.html")) ||
          (await caches.match("./"))
        );
      })
    );

    return;
  }

  // -------------------------------------
  // Critical local program files
  // -------------------------------------
  const fileName = getFileName(request.url);

  if (NETWORK_FIRST_FILES.has(fileName)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // -------------------------------------
  // Images, PDFs, icons and other assets
  // -------------------------------------
  event.respondWith(cacheFirstWithUpdate(event));
});
