/**
 * Served at /sw.js. A Route Handler (rather than a static public/ file) so the
 * build id can be templated straight into the script's bytes — that's what
 * makes a new deploy produce a byte-different service worker, which is the
 * signal the browser (and our own registration.update() polling) uses to
 * detect "a new version is available."
 */
export async function GET() {
  const buildId = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

  const script = `
// Auto-generated per build — do not edit directly (see src/app/sw.js/route.ts).
const BUILD_ID = ${JSON.stringify(buildId)};
const SHELL_CACHE = \`beacon-shell-\${BUILD_ID}\`;
const APP_SHELL = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Lets the page hand control to a waiting worker on demand (the "Reload Now"
// button in the update banner) instead of it taking over unannounced.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Network-first for page navigations (testers should always get the latest
// build when online); same-origin static assets (the JS/CSS the page needs
// to actually render and hydrate — not just the HTML shell) use
// stale-while-revalidate, so once they've been fetched once, the app keeps
// working if the network drops or is unavailable on a later visit.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/").then((res) => res || fetch(request)))
    );
    return;
  }

  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
`.trim();

  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
