// Client-side helpers for the /manage "Service Worker" section. Everything
// here is best-effort: the SW may not be registered, may be in a weird state
// after a version bump, or may simply be missing on non-PWA browsers. Callers
// should treat a null return as "unknown".

export interface CacheBucketStats {
    name: string;
    role: "nav" | "media" | "api" | "static" | "unknown";
    entries: number;
    bytes: number | null;
}

export interface ServiceWorkerInfo {
    version: string | null;
    controllerState: "controlling" | "installed-not-controlling" | "none";
    updateAvailable: boolean;
    buckets: CacheBucketStats[];
    totalBytes: number | null;
    storage: { usage: number; quota: number } | null;
}

// Our only postMessage round-trip helper. A fresh MessageChannel per call
// keeps replies scoped to this request; the SW posts to port1 and closes.
async function requestFromSW<T = unknown>(
    message: Record<string, unknown>,
    timeoutMs = 5000,
): Promise<T | null> {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
    const controller = navigator.serviceWorker.controller;
    if (!controller) return null;
    return new Promise<T | null>((resolve) => {
        const channel = new MessageChannel();
        const timer = window.setTimeout(() => {
            channel.port1.close();
            resolve(null);
        }, timeoutMs);
        channel.port1.onmessage = (event) => {
            window.clearTimeout(timer);
            channel.port1.close();
            resolve((event.data as T) ?? null);
        };
        try {
            controller.postMessage(message, [channel.port2]);
        } catch {
            window.clearTimeout(timer);
            channel.port1.close();
            resolve(null);
        }
    });
}

function roleForCacheName(
    name: string,
    buckets: Record<"nav" | "media" | "api" | "static", string> | null,
): CacheBucketStats["role"] {
    if (!buckets) return "unknown";
    if (name === buckets.nav) return "nav";
    if (name === buckets.media) return "media";
    if (name === buckets.api) return "api";
    if (name === buckets.static) return "static";
    return "unknown";
}

// Iterating a whole cache to sum body sizes is expensive for the media bucket
// (thousands of page images). We cap the per-cache scan and return null when
// the cap is hit so the UI can show "counted N+ entries, size unknown" rather
// than lying about the total.
const MAX_ENTRIES_PER_CACHE = 2000;

async function measureCache(name: string): Promise<{ entries: number; bytes: number | null }> {
    try {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        const entries = keys.length;
        if (entries > MAX_ENTRIES_PER_CACHE) {
            return { entries, bytes: null };
        }
        let bytes = 0;
        for (const key of keys) {
            const match = await cache.match(key);
            if (!match) continue;
            const header = match.headers.get("content-length");
            const headerBytes = header ? Number(header) : 0;
            if (Number.isFinite(headerBytes) && headerBytes > 0) {
                bytes += headerBytes;
                continue;
            }
            try {
                const blob = await match.blob();
                bytes += blob.size;
            } catch {
                // ignore — some responses can't be re-read (e.g. already consumed)
            }
        }
        return { entries, bytes };
    } catch {
        return { entries: 0, bytes: null };
    }
}

async function getStorageEstimateSafe(): Promise<{ usage: number; quota: number } | null> {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    try {
        const estimate = await navigator.storage.estimate();
        return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
    } catch {
        return null;
    }
}

export async function getServiceWorkerInfo(): Promise<ServiceWorkerInfo> {
    const storage = await getStorageEstimateSafe();

    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
        return {
            version: null,
            controllerState: "none",
            updateAvailable: false,
            buckets: [],
            totalBytes: null,
            storage,
        };
    }

    const registration = await navigator.serviceWorker.getRegistration().catch(() => null);
    const controller = navigator.serviceWorker.controller;
    const controllerState: ServiceWorkerInfo["controllerState"] = controller
        ? "controlling"
        : registration?.active
            ? "installed-not-controlling"
            : "none";
    const updateAvailable = Boolean(registration?.waiting);

    const versionInfo = await requestFromSW<{
        ok: boolean;
        version: string;
        buckets: Record<"nav" | "media" | "api" | "static", string>;
    }>({ type: "GET_VERSION" });

    const version = versionInfo?.ok ? versionInfo.version : null;
    const bucketMap = versionInfo?.ok ? versionInfo.buckets : null;

    let buckets: CacheBucketStats[] = [];
    let totalBytes: number | null = 0;
    try {
        const keys = await caches.keys();
        const scoped = version ? keys.filter((k) => k.startsWith(version)) : keys;
        const measured = await Promise.all(
            scoped.map(async (name) => {
                const stats = await measureCache(name);
                return {
                    name,
                    role: roleForCacheName(name, bucketMap),
                    entries: stats.entries,
                    bytes: stats.bytes,
                };
            }),
        );
        buckets = measured;
        for (const bucket of measured) {
            if (bucket.bytes === null) {
                totalBytes = null;
                break;
            }
            if (totalBytes !== null) totalBytes += bucket.bytes;
        }
    } catch {
        buckets = [];
        totalBytes = null;
    }

    return { version, controllerState, updateAvailable, buckets, totalBytes, storage };
}

const APP_SHELL_URLS = ["/", "/search", "/manage", "/cache"] as const;

// Data APIs the main pages depend on to render non-empty content offline.
// Without these in the API cache, the library and /manage render as if the
// account had no series and no tags. The SW's networkFirst on /api/library
// and /api/tags (see sw.js) stores them automatically on any successful
// fetch, so a bare fetch() here suffices.
//
// The library endpoint is fetched both with and without ?nsfw=1 because
// library-home.tsx sends the query param when the NSFW toggle is on, and
// the SW's Cache API treats those as distinct keys. Warming both means
// flipping the toggle offline still renders the right set.
const DATA_API_URLS = [
    "/api/library",
    "/api/library?nsfw=1",
    "/api/tags",
] as const;

export interface RewarmProgress {
    phase:
        | "fetching-html"
        | "parsing-assets"
        | "precaching-html"
        | "precaching-assets"
        | "precaching-data"
        | "done";
    current?: string;
    htmlCount: number;
    assetCount: number;
    dataCount: number;
    cachedHtml: number;
    cachedAssets: number;
    cachedData: number;
    failedHtml: number;
    failedAssets: number;
    failedData: number;
}

// Rewarm strategy:
//   1. Directly fetch() each app-shell HTML route. We have to fetch + parse
//      ourselves because bare fetch() requests don't get routed to the SW's
//      navigate branch and the browser won't follow up with sub-resource
//      requests the way it would for a real navigation. Doing the parse
//      client-side means we know exactly which /_next/static/* URLs this
//      build references and we can precache precisely those.
//   2. Extract asset URLs (CSS/JS/fonts/images) from each HTML.
//   3. Recursively extract url(...) references from each CSS file so font
//      files land in the cache too.
//   4. Ask the SW to PRECACHE_URLS the HTML into NAV_CACHE and the static
//      URLs into STATIC_CACHE. PRECACHE_URLS is an SW-side fetch that
//      definitely stores the response — no iframe mysteries.
export async function rewarmAppShell(
    onProgress?: (progress: RewarmProgress) => void,
): Promise<RewarmProgress> {
    const progress: RewarmProgress = {
        phase: "fetching-html",
        htmlCount: 0,
        assetCount: 0,
        dataCount: 0,
        cachedHtml: 0,
        cachedAssets: 0,
        cachedData: 0,
        failedHtml: 0,
        failedAssets: 0,
        failedData: 0,
    };
    const emit = (patch: Partial<RewarmProgress>) => {
        Object.assign(progress, patch);
        onProgress?.({ ...progress });
    };

    const htmlByUrl = new Map<string, string>();
    for (const url of APP_SHELL_URLS) {
        emit({ phase: "fetching-html", current: url });
        try {
            const res = await fetch(url, { credentials: "same-origin", cache: "reload" });
            if (!res.ok) {
                emit({ failedHtml: progress.failedHtml + 1 });
                continue;
            }
            const html = await res.text();
            htmlByUrl.set(url, html);
            emit({ htmlCount: progress.htmlCount + 1 });
        } catch {
            emit({ failedHtml: progress.failedHtml + 1 });
        }
    }

    emit({ phase: "parsing-assets" });
    const assetUrls = new Set<string>();
    const cssUrls = new Set<string>();
    const ASSET_RE = /(?:href|src)="(\/_next\/static\/[^"']+)"/g;
    for (const html of htmlByUrl.values()) {
        for (const match of html.matchAll(ASSET_RE)) {
            const u = match[1];
            assetUrls.add(u);
            if (u.endsWith(".css")) cssUrls.add(u);
        }
    }

    // Fonts and other CSS-referenced assets are behind `url(...)` inside the
    // CSS, not the HTML. Fetch each CSS file we just found and pull those
    // out too so Inter/etc render correctly offline.
    const CSS_URL_RE = /url\(([^)]+)\)/g;
    for (const cssHref of cssUrls) {
        try {
            emit({ phase: "parsing-assets", current: cssHref });
            const res = await fetch(cssHref, { credentials: "same-origin", cache: "reload" });
            if (!res.ok) continue;
            const cssText = await res.text();
            for (const match of cssText.matchAll(CSS_URL_RE)) {
                const raw = match[1].trim().replace(/^["']|["']$/g, "");
                if (raw.startsWith("/_next/static/")) assetUrls.add(raw);
            }
        } catch {
            // Non-fatal.
        }
    }
    emit({ assetCount: assetUrls.size });

    // Precache HTML routes via the SW. This writes each HTML response into
    // NAV_CACHE keyed by the bare URL ("/"), which is what the SW's nav
    // branch matches against for offline fallbacks.
    emit({ phase: "precaching-html" });
    const htmlUrls = Array.from(htmlByUrl.keys());
    if (htmlUrls.length > 0) {
        // Evict first so re-fetch is idempotent — PRECACHE_URLS skips entries
        // that are already cached, which would otherwise pin stale content
        // from a prior build.
        await requestFromSW({ type: "EVICT_URLS", urls: htmlUrls }, 15000);
        const result = await requestFromSW<{
            ok: boolean;
            results: Array<{ url: string; ok: boolean }>;
        }>({ type: "PRECACHE_URLS", urls: htmlUrls, cache: "nav" }, 60000);
        if (result?.ok && Array.isArray(result.results)) {
            const ok = result.results.filter((r) => r.ok).length;
            emit({ cachedHtml: ok, failedHtml: progress.failedHtml + (result.results.length - ok) });
        }
    }

    // Same for static assets, targeting STATIC_CACHE. This is the fix for
    // the "unstyled icons offline" bug: without these entries in the cache,
    // cached HTML will reference files the browser can't fetch.
    emit({ phase: "precaching-assets" });
    const staticUrls = Array.from(assetUrls);
    if (staticUrls.length > 0) {
        await requestFromSW({ type: "EVICT_URLS", urls: staticUrls }, 30000);
        const result = await requestFromSW<{
            ok: boolean;
            results: Array<{ url: string; ok: boolean }>;
        }>({ type: "PRECACHE_URLS", urls: staticUrls, cache: "static" }, 120000);
        if (result?.ok && Array.isArray(result.results)) {
            const ok = result.results.filter((r) => r.ok).length;
            emit({ cachedAssets: ok, failedAssets: progress.failedAssets + (result.results.length - ok) });
        }
    }

    // Warm the handful of data APIs the main pages fetch on mount. These get
    // cached by the SW's networkFirst branch automatically, so a plain fetch
    // is enough; we don't route through PRECACHE_URLS because those endpoints
    // are already in the SW allowlist.
    emit({ phase: "precaching-data" });
    for (const href of DATA_API_URLS) {
        emit({ phase: "precaching-data", current: href });
        try {
            const res = await fetch(href, { credentials: "same-origin", cache: "reload" });
            emit({
                dataCount: progress.dataCount + 1,
                cachedData: progress.cachedData + (res.ok ? 1 : 0),
                failedData: progress.failedData + (res.ok ? 0 : 1),
            });
        } catch {
            emit({
                dataCount: progress.dataCount + 1,
                failedData: progress.failedData + 1,
            });
        }
    }

    emit({ phase: "done", current: undefined });
    return progress;
}

// Dump a sample of URLs from each cache bucket so the user can share what's
// actually stored when things look wrong. Capped to SAMPLE_LIMIT per bucket
// to keep the UI readable for a thousands-of-images media cache.
const SAMPLE_LIMIT = 10;

export interface CacheSample {
    name: string;
    role: CacheBucketStats["role"];
    totalEntries: number;
    sample: string[];
}

export async function sampleCacheContents(): Promise<CacheSample[]> {
    if (typeof caches === "undefined") return [];
    const versionInfo = await requestFromSW<{
        ok: boolean;
        version: string;
        buckets: Record<"nav" | "media" | "api" | "static", string>;
    }>({ type: "GET_VERSION" });
    const version = versionInfo?.ok ? versionInfo.version : null;
    const bucketMap = versionInfo?.ok ? versionInfo.buckets : null;
    try {
        const keys = await caches.keys();
        const scoped = version ? keys.filter((k) => k.startsWith(version)) : keys;
        const samples: CacheSample[] = [];
        for (const name of scoped) {
            const cache = await caches.open(name);
            const entries = await cache.keys();
            samples.push({
                name,
                role: roleForCacheName(name, bucketMap),
                totalEntries: entries.length,
                sample: entries.slice(0, SAMPLE_LIMIT).map((r) => {
                    try {
                        const u = new URL(r.url);
                        return u.pathname + u.search;
                    } catch {
                        return r.url;
                    }
                }),
            });
        }
        return samples;
    } catch {
        return [];
    }
}

export async function clearServiceWorkerCaches(): Promise<boolean> {
    const result = await requestFromSW<{ ok: boolean }>({ type: "CLEAR_CACHES" });
    return Boolean(result?.ok);
}

// Tell the waiting SW to take over now, then reload to let it control the page.
// Without the reload, the current tab keeps talking to the old SW until it's
// idle, which isn't what the user expects after clicking "Update".
export async function applyPendingServiceWorkerUpdate(): Promise<void> {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration().catch(() => null);
    const waiting = registration?.waiting;
    if (!waiting) {
        if (typeof window !== "undefined") window.location.reload();
        return;
    }
    waiting.postMessage({ type: "SKIP_WAITING" });
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        await new Promise<void>((resolve) => {
            let resolved = false;
            const done = () => {
                if (resolved) return;
                resolved = true;
                resolve();
            };
            navigator.serviceWorker.addEventListener("controllerchange", done, { once: true });
            window.setTimeout(done, 3000);
        });
    }
    if (typeof window !== "undefined") window.location.reload();
}

// Ask the active registration to check for a newer SW on the server. Useful
// right before the "Apply update" button so the user can see in real time
// whether a v7 is sitting on the server. Returns whether a waiting worker
// exists after the update check finished.
export async function checkForServiceWorkerUpdate(): Promise<boolean> {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration().catch(() => null);
    if (!registration) return false;
    try {
        await registration.update();
    } catch {
        // ignore — update() rejects on some browsers when offline
    }
    return Boolean(registration.waiting);
}

