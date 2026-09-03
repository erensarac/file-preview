/*
 * The service worker.
 *
 * Its only job is to make the app work with no connection. Almost every format
 * this site opens is parsed in the tab and never uploaded, so offline is not a
 * degraded mode for them — there is no round-trip to lose. What was missing
 * was the shell.
 *
 * ── Network-first, always ────────────────────────────────────────────────
 *
 * The usual way to write this is cache-first for static assets, which is
 * faster and is also the easiest way to ship a bug that outlives its fix: a
 * stale entry is served forever, and "clear your cache" does not reach someone
 * who installed the app rather than bookmarking it.
 *
 * So the network is always tried first and the cache is only ever a fallback.
 * Online, a visitor cannot be served anything but the current build. The cost
 * is that this buys no speed — which is fine, because speed was not the
 * problem. Offline capability was.
 *
 * ── What is never cached ─────────────────────────────────────────────────
 *
 * Only same-origin GETs, and only successful ones. The server action that
 * converts Excel and Word is a POST and is skipped by that rule alone, but the
 * intent is worth stating plainly: this cache holds our own assets and never
 * anything derived from a user's file. The privacy split is the product, and
 * a cache that quietly retained document content would break it.
 */

const CACHE = "file-shell-v1";

self.addEventListener("install", () => {
  /*
   * No precache list. Everything here is cached as it is genuinely fetched,
   * which keeps this worker from carrying a hand-written inventory of build
   * artefacts that goes stale the moment a chunk is renamed.
   *
   * The consequence is that offline works from the second visit, and a PDF
   * opens offline only once pdf.js's worker and fonts have been fetched at
   * least once — which happens the first time any PDF is opened.
   */
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);

        /*
         * `basic` means same-origin and fully readable. An opaque or errored
         * response cached here would be replayed offline as a broken asset,
         * which is worse than the failure it came from.
         */
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }

        return response;
      } catch (error) {
        const cached = await caches.match(request);
        if (cached) return cached;

        /*
         * An unvisited page, offline. The app shell can still open a file, so
         * it is a better answer than the browser's error page — the address
         * bar keeps the URL that was asked for.
         */
        if (request.mode === "navigate") {
          const shell = await caches.match("/");
          if (shell) return shell;
        }

        throw error;
      }
    })(),
  );
});
