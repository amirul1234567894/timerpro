// ============================================================
// TimerPro — Service Worker
// Version: bump CACHE_NAME on every deploy to bust old cache
// ============================================================

const CACHE_NAME = "timerpro-v4";

const PRE_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// ── INSTALL ─────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  console.log(`[SW] Installing cache: ${CACHE_NAME}`);

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("[SW] Pre-caching essential assets");
        return cache.addAll(PRE_CACHE);
      })
      .then(() => {
        console.log("[SW] Install complete — skipping waiting");
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error("[SW] Pre-cache failed:", err);
      })
  );
});

// ── ACTIVATE ────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  console.log(`[SW] Activating: ${CACHE_NAME}`);

  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((oldKey) => {
              console.log(`[SW] Deleting old cache: ${oldKey}`);
              return caches.delete(oldKey);
            })
        );
      })
      .then(() => {
        console.log("[SW] Old caches cleared — claiming clients");
        return self.clients.claim();
      })
  );
});

// ── FETCH ───────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-GET and cross-origin requests
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // Ignore browser extensions and devtools
  if (!url.protocol.startsWith("http")) return;

  const isHTML = request.headers.get("Accept")?.includes("text/html");
  const isAsset = /\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf|json|webp)(\?.*)?$/.test(url.pathname);

  if (isHTML) {
    // ── Network-first for HTML ──────────────────────────────
    // Always try network so updates show immediately
    event.respondWith(networkFirst(request));
  } else if (isAsset) {
    // ── Cache-first for static assets ──────────────────────
    // Serve from cache instantly, revalidate in background
    event.respondWith(cacheFirst(request));
  } else {
    // ── Network-first for everything else ──────────────────
    event.respondWith(networkFirst(request));
  }
});

// ── STRATEGIES ──────────────────────────────────────────────

/**
 * Network-first: try network, fall back to cache.
 * Falls back to /index.html for offline navigation.
 */
async function networkFirst(request) {
  const url = new URL(request.url);
  console.log(`[SW] Network-first: ${url.pathname}`);

  try {
    const networkResponse = await fetch(request);

    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (err) {
    console.warn(`[SW] Network failed for ${url.pathname}, trying cache`);

    const cached = await caches.match(request);
    if (cached) return cached;

    // Offline fallback: serve index.html for navigation requests
    if (request.mode === "navigate") {
      console.warn("[SW] Serving offline fallback: /index.html");
      const fallback = await caches.match("/index.html");
      if (fallback) return fallback;
    }

    // Nothing available
    return new Response("Offline — please check your connection.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

/**
 * Cache-first: serve from cache, fetch and update in background.
 * If not cached, fetch from network and store.
 */
async function cacheFirst(request) {
  const url = new URL(request.url);

  const cached = await caches.match(request);
  if (cached) {
    console.log(`[SW] Cache-first HIT: ${url.pathname}`);

    // Revalidate in background (stale-while-revalidate)
    revalidateInBackground(request);
    return cached;
  }

  // Not in cache — fetch and store
  console.log(`[SW] Cache-first MISS: ${url.pathname} — fetching`);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.error(`[SW] Cache-first network error: ${url.pathname}`, err);
    return new Response("Asset unavailable offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

/**
 * Silently refresh a cached asset in the background.
 */
function revalidateInBackground(request) {
  fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response);
        console.log(`[SW] Background revalidated: ${new URL(request.url).pathname}`);
      }
    })
    .catch(() => {
      // Ignore background revalidation errors silently
    });
}