/*
 * El Corazon — service worker.
 *
 * Deliberately minimal and hand-written (no Workbox / vite-plugin-pwa) so it
 * adds no build dependencies to the Vite 7 setup.
 *
 * Rules:
 *   - Cross-origin requests (Supabase REST/RPC, the supabase-js CDN bundle)
 *     are never intercepted. Financial data is always live; nothing is served
 *     from a stale cache.
 *   - Navigations are network-first, falling back to the cached shell only
 *     when the phone is offline. A deploy therefore reaches users on their
 *     next load, not their next week.
 *   - /assets/* is content-hashed by Vite, so it is safe to cache forever.
 *
 * Bump CACHE_VERSION to force every client to drop its caches.
 */
const CACHE_VERSION = "v1";
const SHELL_CACHE = "ec-shell-" + CACHE_VERSION;
const ASSET_CACHE = "ec-assets-" + CACHE_VERSION;
const SHELL_URL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(new Request(SHELL_URL, { cache: "reload" })))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k))
      );
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {}
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // Supabase and any CDN stay entirely off the cache path.
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          const res = preloaded || (await fetch(req));
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(SHELL_URL, copy)).catch(() => {});
          }
          return res;
        } catch {
          const cached = await caches.match(SHELL_URL, { cacheName: SHELL_CACHE });
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req, { cacheName: ASSET_CACHE });
        if (cached) return cached;
        const res = await fetch(req);
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(ASSET_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })()
    );
  }
});
