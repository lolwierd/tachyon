// Bump VERSION on every breaking ship — the browser only re-fetches /sw.js
// when the byte content changes, and `activate` only nukes caches whose name
// doesn't match the current VERSION. Without a bump, an installed PWA keeps
// serving cached HTML / static bundles from the previous deploy, which is
// what made the v17 scrobbler invisible to standalone iOS users until now.
const VERSION = "reader-sw-v9";
const NAV_CACHE = `${VERSION}-nav`;
const MEDIA_CACHE = `${VERSION}-media`;
const API_CACHE = `${VERSION}-api`;
const STATIC_CACHE = `${VERSION}-static`;

const APP_SHELL = ["/", "/search", "/manage", "/cache", "/manifest.webmanifest"];

// Standalone "you're offline" page served when a nav request fails AND the
// exact URL isn't in the nav cache. Previously we silently served a
// different cached page (e.g. `/` for /downloads, /cache for /read/*),
// which left the URL bar showing one route and the page rendering another —
// indistinguishable from a broken app. This keeps the URL correct and
// tells the user what happened. Minimal inline CSS/JS to avoid any
// dependency on /_next/static chunks that may not be cached.
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Offline · Tachyon</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; min-height: 100dvh; }
  body {
    background: #07080c;
    color: #e7e6df;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: calc(env(safe-area-inset-top, 0px) + 2rem) 1.5rem calc(env(safe-area-inset-bottom, 0px) + 2rem);
    text-align: center; gap: 1.25rem;
  }
  h1 { font-size: 1.75rem; font-weight: 500; margin: 0; }
  p { color: #8a8878; margin: 0; max-width: 28rem; line-height: 1.5; font-size: 0.95rem; }
  .url {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem; color: #f4b942;
    background: rgba(244, 185, 66, 0.08);
    padding: 0.25rem 0.5rem; border-radius: 4px;
    word-break: break-all; max-width: 28rem;
  }
  .links { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center; }
  a {
    padding: 0.5rem 1rem; border-radius: 4px; text-decoration: none;
    font-size: 0.875rem;
    border: 1px solid rgba(244, 185, 66, 0.3);
    background: rgba(244, 185, 66, 0.08);
    color: #f4b942;
  }
  a:active { background: rgba(244, 185, 66, 0.18); }
</style>
</head>
<body>
  <h1>You're offline</h1>
  <p>This page isn't cached on your device. Your library and downloaded chapters are still available.</p>
  <div class="url" id="u"></div>
  <div class="links">
    <a href="/">Library</a>
    <a href="/cache">Downloads</a>
  </div>
  <script>
    try { document.getElementById('u').textContent = location.pathname + location.search; } catch (e) {}
    // Auto-reload when the browser reports we're back online, so the user
    // doesn't have to manually refresh after reconnecting.
    window.addEventListener('online', function () { location.reload(); });
  </script>
</body>
</html>`;

function offlineHtmlResponse() {
    return new Response(OFFLINE_HTML, {
        status: 200,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(NAV_CACHE)
            .then((cache) =>
                Promise.all(
                    APP_SHELL.map((url) =>
                        cache.add(url).catch(() => {
                            // Best-effort: /cache may not exist on older builds.
                        }),
                    ),
                ),
            )
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => ![NAV_CACHE, MEDIA_CACHE, API_CACHE, STATIC_CACHE].includes(key))
                        .map((key) => caches.delete(key)),
                ),
            )
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;

    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);
    const isSameOrigin = url.origin === self.location.origin;

    if (!isSameOrigin) {
        return;
    }

    if (request.mode === "navigate") {
        // Network-first is required: cached HTML references hashed
        // /_next/static/* assets that change on every deploy. Serving stale
        // HTML leaves the page pointing at CSS/JS files that no longer exist
        // on the server, which manifests as a white screen with no styles.
        //
        // If the exact URL is cached (app-shell routes, pinned chapter
        // readers), we serve that. Otherwise networkFirst returns the
        // standalone offline page so the URL stays in sync with what's
        // rendered instead of silently redirecting.
        event.respondWith(networkFirst(request, NAV_CACHE));
        return;
    }

    if (url.pathname.startsWith("/api/media/page") || request.destination === "image") {
        event.respondWith(cacheFirst(request, MEDIA_CACHE));
        return;
    }

    // Next.js ships hashed, immutable bundles under /_next/static/*. Without
    // an SW cache for these, an offline navigation serves cached HTML whose
    // referenced CSS/JS URLs hit the network and fail — leaving unstyled,
    // unscripted HTML (the "raw icons and blue links" screen). Cache-first
    // here is safe because the hashes change on every deploy, and the whole
    // bucket is discarded when the SW VERSION bumps on the next release.
    if (url.pathname.startsWith("/_next/static/")) {
        event.respondWith(cacheFirst(request, STATIC_CACHE));
        return;
    }

    if (
        url.pathname.startsWith("/api/chapters/") ||
        url.pathname.startsWith("/api/series/") ||
        url.pathname.startsWith("/api/library") ||
        url.pathname.startsWith("/api/reader/state") ||
        url.pathname.startsWith("/api/tags")
    ) {
        event.respondWith(networkFirst(request, API_CACHE));
    }
});

// The client can ask the SW to precache or evict individual URLs. The SW
// channel is more durable than an in-page fetch because it survives minor
// navigation churn, and it lets us report precise per-URL outcomes back
// to the caller via MessageChannel.
self.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;

    if (data.type === "PRECACHE_URLS" && Array.isArray(data.urls)) {
        const port = event.ports && event.ports[0];
        const targetCache =
            data.cache === "nav" ? NAV_CACHE :
            data.cache === "api" ? API_CACHE :
            data.cache === "static" ? STATIC_CACHE :
            MEDIA_CACHE;
        event.waitUntil(
            precacheUrls(data.urls, targetCache)
                .then((results) => {
                    if (port) port.postMessage({ ok: true, results });
                })
                .catch((error) => {
                    if (port) port.postMessage({ ok: false, error: String(error && error.message || error) });
                }),
        );
        return;
    }

    if (data.type === "EVICT_URLS" && Array.isArray(data.urls)) {
        const port = event.ports && event.ports[0];
        event.waitUntil(
            evictUrls(data.urls).then((removed) => {
                if (port) port.postMessage({ ok: true, removed });
            }),
        );
        return;
    }

    // Report SW identity + cache bucket names back to the page. The client
    // uses this to render the Service Worker section under /manage without
    // hardcoding the version string on both sides.
    if (data.type === "GET_VERSION") {
        const port = event.ports && event.ports[0];
        if (port) {
            port.postMessage({
                ok: true,
                version: VERSION,
                buckets: {
                    nav: NAV_CACHE,
                    media: MEDIA_CACHE,
                    api: API_CACHE,
                    static: STATIC_CACHE,
                },
            });
        }
        return;
    }

    // Nuke every cache whose name belongs to this SW version. Used by the
    // "Clear offline cache" button. We scope to VERSION-prefixed buckets so
    // caches from other apps on the same origin are left alone.
    if (data.type === "CLEAR_CACHES") {
        const port = event.ports && event.ports[0];
        event.waitUntil(
            caches
                .keys()
                .then((keys) =>
                    Promise.all(
                        keys
                            .filter((key) => key.startsWith(VERSION))
                            .map((key) => caches.delete(key).then((ok) => ({ key, ok }))),
                    ),
                )
                .then((cleared) => {
                    if (port) port.postMessage({ ok: true, cleared });
                })
                .catch((error) => {
                    if (port) port.postMessage({ ok: false, error: String(error && error.message || error) });
                }),
        );
        return;
    }

    if (data.type === "SKIP_WAITING") {
        self.skipWaiting();
    }
});

async function precacheUrls(urls, cacheName) {
    const cache = await caches.open(cacheName);
    const results = [];

    for (const url of urls) {
        try {
            const request = new Request(url, { credentials: "same-origin" });
            const cached = await cache.match(request);
            if (cached) {
                const sizeHeader = cached.headers.get("content-length");
                results.push({ url, ok: true, cached: true, bytes: sizeHeader ? Number(sizeHeader) : null });
                continue;
            }
            const response = await fetch(request);
            if (!response.ok) {
                results.push({ url, ok: false, status: response.status });
                continue;
            }
            const clone = response.clone();
            await cache.put(request, clone);
            // Consume the original body to free the underlying connection.
            // Without this, iOS Safari holds connections open for unconsumed
            // streams which can exhaust the per-origin connection pool.
            const blob = await response.blob();
            const bytes = Number(response.headers.get("content-length")) || blob.size || null;
            results.push({ url, ok: true, cached: false, bytes });
        } catch (error) {
            results.push({ url, ok: false, error: String(error && error.message || error) });
        }
    }

    return results;
}

async function evictUrls(urls) {
    const removed = [];
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
        if (!name.startsWith(VERSION)) continue;
        const cache = await caches.open(name);
        for (const url of urls) {
            try {
                const request = new Request(url, { credentials: "same-origin" });
                const ok = await cache.delete(request, { ignoreVary: true });
                if (ok) removed.push({ url, cache: name });
            } catch {
                // ignore
            }
        }
    }
    return removed;
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) {
        return cached;
    }

    try {
        const response = await fetch(request);
        if (response && response.ok) {
            await cache.put(request, response.clone());
            return response;
        }
        // Cloudflare tunnel errors masquerade as successful HTTP responses.
        // Treat them as offline so the similar-media fallback gets a chance.
        if (isOriginUnreachable(response)) {
            const fallback = await findSimilarMedia(cache, request);
            if (fallback) return fallback;
        }
        return response;
    } catch (error) {
        // Offline and not cached — fall back to any similar image already
        // stored under a different query string (e.g. /api/media/page?url=
        // with slightly different referer params). This is lenient on
        // purpose so the reader stays usable offline.
        const fallback = await findSimilarMedia(cache, request);
        if (fallback) return fallback;
        throw error;
    }
}

// Cap the scan so large media caches don't stall the SW on repeated misses.
const SIMILAR_MEDIA_SCAN_LIMIT = 200;

async function findSimilarMedia(cache, request) {
    try {
        const url = new URL(request.url);
        if (!url.pathname.startsWith("/api/media/page")) return null;
        const target = url.searchParams.get("url");
        if (!target) return null;
        const keys = await cache.keys();
        const limit = Math.min(keys.length, SIMILAR_MEDIA_SCAN_LIMIT);
        for (let i = 0; i < limit; i++) {
            const key = keys[i];
            try {
                const keyUrl = new URL(key.url);
                if (
                    keyUrl.pathname === url.pathname &&
                    keyUrl.searchParams.get("url") === target
                ) {
                    const match = await cache.match(key);
                    if (match) return match;
                }
            } catch {
                // ignore malformed keys
            }
        }
    } catch {
        // ignore
    }
    return null;
}

// A fetch can "succeed" with an error response — most commonly Cloudflare
// tunnel errors (520-530) when the origin is unreachable. These look like
// valid HTTP responses to fetch() but are useless to the app: the HTML is
// a Cloudflare error page, and any JSON-parsing caller will crash. Treat
// them as offline so cache fallbacks kick in.
function isOriginUnreachable(response) {
    if (!response) return true;
    // Cloudflare emits 520-530 for origin/tunnel problems; 502/503/504 are
    // the generic upstream-dead range. Anything <500 is a real app response
    // we should honor (404s, 401s, etc).
    if (response.status >= 520 && response.status <= 530) return true;
    if (response.status === 502 || response.status === 503 || response.status === 504) return true;
    // Cloudflare sets cf-ray on every response it generates. If we also see
    // a 5xx, it's almost certainly an edge-level error, not an app response.
    if (response.status >= 500 && response.headers.get("cf-ray")) return true;
    return false;
}

async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);

    try {
        const response = await fetch(request);
        if (response && response.ok) {
            await cache.put(request, response.clone());
            return response;
        }
        // Non-ok response: if the origin is unreachable (tunnel down, CF
        // error), prefer any cached copy for the exact URL. If we don't
        // have one and this is a navigation, serve the offline page
        // instead of returning the error HTML. For non-nav requests
        // (API fetches) and genuine app errors (404, 401), return the
        // real response so the caller can handle it.
        if (isOriginUnreachable(response)) {
            const cached = await cache.match(request);
            if (cached) return cached;
            if (request.mode === "navigate") return offlineHtmlResponse();
        }
        return response;
    } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return offlineHtmlResponse();
        return new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
        });
    }
}
