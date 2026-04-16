const VERSION = "reader-sw-v6";
const NAV_CACHE = `${VERSION}-nav`;
const MEDIA_CACHE = `${VERSION}-media`;
const API_CACHE = `${VERSION}-api`;
const STATIC_CACHE = `${VERSION}-static`;

const APP_SHELL = ["/", "/search", "/manage", "/cache", "/manifest.webmanifest"];

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
        // Reader routes fall back to /cache (the downloaded shelf) instead
        // of / so a dead-tunnel deep-link lands on locally-available content
        // rather than an empty library.
        const navFallback = url.pathname.startsWith("/read/") ? "/cache" : "/";
        event.respondWith(networkFirst(request, NAV_CACHE, navFallback));
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
        url.pathname.startsWith("/api/reader/state")
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
        event.waitUntil(
            precacheUrls(data.urls, data.cache === "nav" ? NAV_CACHE : data.cache === "api" ? API_CACHE : MEDIA_CACHE)
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

async function networkFirst(request, cacheName, fallbackPath) {
    const cache = await caches.open(cacheName);

    try {
        const response = await fetch(request);
        if (response && response.ok) {
            await cache.put(request, response.clone());
            return response;
        }
        // Non-ok response: if the origin is unreachable (tunnel down, CF
        // error), prefer any cached copy we have over the error page. For
        // other non-ok responses (404, 401, etc), honor the live response.
        if (isOriginUnreachable(response)) {
            const cached = await cache.match(request);
            if (cached) return cached;
            if (fallbackPath) {
                const fallback = await cache.match(fallbackPath);
                if (fallback) return fallback;
            }
        }
        return response;
    } catch {
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }
        if (fallbackPath) {
            const fallback = await cache.match(fallbackPath);
            if (fallback) {
                return fallback;
            }
        }
        return new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
        });
    }
}
