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

// Re-priming the app shell requires honest navigations — a bare fetch("/") has
// mode "cors", which the SW's nav branch skips. Hidden iframes trigger real
// nav-mode requests and the browser follows up with every referenced static
// asset, which is exactly what populates NAV_CACHE + STATIC_CACHE together.
const APP_SHELL_URLS = ["/", "/search", "/manage", "/cache"] as const;

export interface RewarmProgress {
    url: string;
    status: "loading" | "done" | "error";
}

export async function rewarmAppShell(
    onProgress?: (progress: RewarmProgress) => void,
): Promise<void> {
    if (typeof document === "undefined") return;

    for (const url of APP_SHELL_URLS) {
        onProgress?.({ url, status: "loading" });
        await new Promise<void>((resolve) => {
            const iframe = document.createElement("iframe");
            iframe.style.position = "fixed";
            iframe.style.width = "1px";
            iframe.style.height = "1px";
            iframe.style.opacity = "0";
            iframe.style.pointerEvents = "none";
            iframe.style.border = "none";
            iframe.setAttribute("aria-hidden", "true");
            iframe.setAttribute("tabindex", "-1");
            // Guard: if the iframe never fires onload (e.g. origin blocks framing
            // or SW is slow), force-resolve so the caller isn't wedged.
            const timeout = window.setTimeout(() => {
                cleanup("error");
            }, 20000);
            const cleanup = (outcome: "done" | "error") => {
                window.clearTimeout(timeout);
                try { iframe.remove(); } catch { /* ignore */ }
                onProgress?.({ url, status: outcome });
                resolve();
            };
            iframe.onload = () => cleanup("done");
            iframe.onerror = () => cleanup("error");
            iframe.src = url;
            document.body.appendChild(iframe);
        });
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

export function formatBytes(bytes: number | null | undefined): string {
    if (bytes == null || !Number.isFinite(bytes)) return "—";
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
