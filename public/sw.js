const VERSION = "reader-sw-v2";
const NAV_CACHE = `${VERSION}-nav`;
const MEDIA_CACHE = `${VERSION}-media`;
const API_CACHE = `${VERSION}-api`;

const APP_SHELL = ["/", "/search", "/manage", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(NAV_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
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
        const refreshPromise = refreshCache(request, NAV_CACHE);
        event.respondWith(staleWhileRevalidateNavigation(request, refreshPromise));
        event.waitUntil(refreshPromise.catch(() => undefined));
        return;
    }

    if (url.pathname.startsWith("/api/media/page") || request.destination === "image") {
        event.respondWith(cacheFirst(request, MEDIA_CACHE));
        return;
    }

    if (
        url.pathname.startsWith("/api/chapters/") ||
        url.pathname.startsWith("/api/series/") ||
        url.pathname.startsWith("/api/library")
    ) {
        event.respondWith(networkFirst(request, API_CACHE));
    }
});

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) {
        return cached;
    }

    const response = await fetch(request);
    if (response && response.ok) {
        await cache.put(request, response.clone());
    }
    return response;
}

async function refreshCache(request, cacheName) {
    const response = await fetch(request);
    if (response && response.ok) {
        const cache = await caches.open(cacheName);
        await cache.put(request, response.clone());
    }
    return response;
}

async function staleWhileRevalidateNavigation(request, refreshPromise) {
    const cache = await caches.open(NAV_CACHE);
    const cached = await cache.match(request);
    if (cached) {
        return cached;
    }

    const fallback = await cache.match("/");
    if (fallback) {
        return fallback;
    }

    try {
        return await refreshPromise;
    } catch {
        return new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
        });
    }
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
