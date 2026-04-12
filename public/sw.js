const VERSION = "reader-sw-v4";
const NAV_CACHE = `${VERSION}-nav`;
const MEDIA_CACHE = `${VERSION}-media`;
const API_CACHE = `${VERSION}-api`;

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
                        .filter((key) => ![NAV_CACHE, MEDIA_CACHE, API_CACHE].includes(key))
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
        // Reader routes are an exception: when offline, fall back to a
        // previously cached copy so locally-cached chapters can be opened.
        event.respondWith(networkFirst(request, NAV_CACHE, "/"));
        return;
    }

    if (url.pathname.startsWith("/api/media/page") || request.destination === "image") {
        event.respondWith(cacheFirst(request, MEDIA_CACHE));
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
            const sizeHeader = response.headers.get("content-length");
            results.push({ url, ok: true, cached: false, bytes: sizeHeader ? Number(sizeHeader) : null });
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
                const ok = await cache.delete(request);
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

async function networkFirst(request, cacheName, fallbackPath) {
    const cache = await caches.open(cacheName);

    try {
        const response = await fetch(request);
        if (response && response.ok) {
            await cache.put(request, response.clone());
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
