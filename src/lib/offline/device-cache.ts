/**
 * Client-side "cache a chapter to this device" implementation.
 *
 * Flow:
 *   1. Fetch the chapter's page manifest via `/api/chapters/{id}/pages?...`.
 *      That request is routed through the service worker's network-first
 *      handler so the JSON ends up in API_CACHE and is available offline.
 *   2. Pre-fetch the reader HTML (`/read/{seriesId}/{chapterId}?...`) so the
 *      service worker's network-first nav handler caches it and the reader
 *      can be opened while offline.
 *   3. For each page, `fetch()` the proxied image URL. The SW's cache-first
 *      handler for `/api/media/page` stashes the response in MEDIA_CACHE.
 *   4. Write a CachedChapterEntry into IndexedDB so the /cache page can list
 *      this chapter without needing the server.
 *
 * Deletion reverses the process: evict image URLs from MEDIA_CACHE, remove
 * the reader HTML from NAV_CACHE, and drop the IDB entry.
 *
 * This is separate from the server-side "pin" system in
 * `src/lib/offline/state.ts`: server pins put bytes on the server disk so
 * scraping can be skipped; device cache puts bytes on *this device* so the
 * iOS PWA can read without any network at all.
 */

import type { ChapterPage } from "@/lib/sources/types";
import { buildReaderHref as buildReaderHrefShared } from "@/lib/reader/url";
import {
    deleteCachedChapter,
    getCachedChapterIds,
    listCachedChapters,
    listCachedChaptersForSeries,
    putCachedChapter,
    type CachedChapterEntry,
} from "./cache-db";

export interface CacheChapterInput {
    seriesId: string;
    chapterId: string;
    sourceName: string | null;
    chapterNo: number;
    title: string;
    seriesTitle?: string | null;
    seriesCoverUrl?: string | null;
}

export interface CacheChapterProgress {
    loadedPages: number;
    totalPages: number;
    bytesSoFar: number;
}

export interface CacheChapterOptions {
    signal?: AbortSignal;
    onProgress?: (progress: CacheChapterProgress) => void;
    /**
     * How many image fetches to run in parallel. iOS Safari caps the
     * effective concurrency per-origin pretty aggressively, so 2–3 gives
     * a nice speedup without thrashing.
     */
    concurrency?: number;
}

export interface CacheChapterResult {
    entry: CachedChapterEntry;
    fetchedPages: number;
    failedPages: number;
    bytes: number;
}

// ⚠️  Keep in sync with the VERSION constant in public/sw.js.
// The SW is a plain JS file and can't import from src/, so the
// version string is duplicated. If you bump the SW version, update
// this prefix too or removeChapterFromDevice will evict from the
// wrong (old) cache, leaving orphaned entries in the new one.
const SW_CACHE_PREFIX = "reader-sw-v10";
const READER_HTML_CACHE = `${SW_CACHE_PREFIX}-nav`;
const CHAPTER_PAGES_API_CACHE = `${SW_CACHE_PREFIX}-api`;

function buildChapterPagesUrl(input: Pick<CacheChapterInput, "seriesId" | "chapterId" | "sourceName">): string {
    const params = new URLSearchParams({ seriesId: input.seriesId });
    if (input.sourceName) params.set("source", input.sourceName);
    return `/api/chapters/${encodeURIComponent(input.chapterId)}/pages?${params.toString()}`;
}

function buildReaderHref(input: Pick<CacheChapterInput, "seriesId" | "chapterId" | "sourceName">): string {
    return buildReaderHrefShared(input.seriesId, input.chapterId, input.sourceName);
}

// The reader view fans out to four APIs on mount; the pages URL is fetched
// separately to extract the page list, but the other three only need to land
// in the SW's API cache so they can be served offline. The SW's networkFirst
// strategy populates the cache on any successful fetch, so a bare fetch here
// is sufficient — no manual cache.put required.
//
// URLs MUST be byte-for-byte identical to what reader-view.tsx constructs at
// mount (lines ~540-547), because the SW Cache API keys by the exact URL
// string. URLSearchParams encodes spaces as '+' while template literals with
// encodeURIComponent use '%20' — a mismatch would cause silent cache misses
// for any seriesId/chapterId containing spaces.
export function buildReaderPrecacheUrls(
    input: Pick<CacheChapterInput, "seriesId" | "chapterId" | "sourceName">,
): string[] {
    const seriesId = encodeURIComponent(input.seriesId);
    const chapterId = encodeURIComponent(input.chapterId);
    const sourceSuffix = input.sourceName ? `?source=${encodeURIComponent(input.sourceName)}` : "";
    const stateSourceSuffix = input.sourceName ? `&source=${encodeURIComponent(input.sourceName)}` : "";
    return [
        `/api/series/${seriesId}${sourceSuffix}`,
        `/api/series/${seriesId}/chapters${sourceSuffix}`,
        `/api/reader/state?seriesId=${seriesId}&chapterId=${chapterId}${stateSourceSuffix}`,
    ];
}

async function fetchWithAbort(input: RequestInfo | URL, signal?: AbortSignal): Promise<Response> {
    if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
    }
    return fetch(input, { signal, credentials: "same-origin" });
}

function getResponseBytes(response: Response): number {
    const header = response.headers.get("content-length");
    if (header) {
        const parsed = Number(header);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
}

async function waitForServiceWorkerReady(): Promise<void> {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    try {
        await navigator.serviceWorker.ready;
    } catch {
        // ignore — we'll still attempt fetches without SW intermediation
    }
}

/**
 * Ensure the browser treats this origin's storage as persistent so iOS
 * doesn't evict the cached chapters when the PWA is backgrounded for a while.
 * Best-effort — silently no-ops if the API is missing or permission is denied.
 */
export async function requestPersistentStorage(): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    try {
        const alreadyPersisted = await navigator.storage.persisted?.();
        if (alreadyPersisted) return true;
        return await navigator.storage.persist();
    } catch {
        return false;
    }
}

/**
 * Get used/available storage, suitable for a "you're using X / Y" display.
 */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    try {
        const estimate = await navigator.storage.estimate();
        return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
    } catch {
        return null;
    }
}

/**
 * Cache a single chapter onto this device.
 *
 * This function records progress in the device cache database while it works,
 * but callers should not assume it will detect and reuse an already-cached
 * chapter without performing additional fetch work.
 */
export async function cacheChapterToDevice(
    input: CacheChapterInput,
    options: CacheChapterOptions = {},
): Promise<CacheChapterResult> {
    const { signal, onProgress, concurrency = 2 } = options;
    await waitForServiceWorkerReady();

    // Record a "pending" entry up-front so the /cache page can show that a
    // chapter is being worked on even if the tab is reloaded mid-download.
    const now = Date.now();
    const pendingEntry: CachedChapterEntry = {
        key: `${input.seriesId}::${input.chapterId}`,
        seriesId: input.seriesId,
        sourceName: input.sourceName,
        chapterId: input.chapterId,
        chapterNo: input.chapterNo,
        title: input.title,
        seriesTitle: input.seriesTitle ?? null,
        seriesCoverUrl: input.seriesCoverUrl ?? null,
        pageCount: 0,
        pageUrls: [],
        bytes: 0,
        state: "pending",
        cachedAt: now,
        updatedAt: now,
        error: null,
    };
    try {
        await putCachedChapter(pendingEntry);
    } catch {
        // IDB isn't available; continue best-effort.
    }

    const pagesUrl = buildChapterPagesUrl(input);
    let pages: ChapterPage[];
    try {
        const res = await fetchWithAbort(pagesUrl, signal);
        if (!res.ok) {
            throw new Error(`Failed to load chapter pages: HTTP ${res.status}`);
        }
        pages = (await res.json()) as ChapterPage[];
        if (!Array.isArray(pages) || pages.length === 0) {
            throw new Error("Chapter has no pages");
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        const failedEntry: CachedChapterEntry = {
            ...pendingEntry,
            state: "failed",
            updatedAt: Date.now(),
            error: message,
        };
        try {
            await putCachedChapter(failedEntry);
        } catch {
            // ignore
        }
        throw error;
    }

    // Best-effort: pre-fetch the reader HTML so the shell can boot offline.
    // We manually put the response into the nav cache because this fetch has
    // `mode: "cors"` (not "navigate"), so the SW fetch handler won't intercept it.
    const readerHref = buildReaderHref(input);
    try {
        const htmlRes = await fetchWithAbort(readerHref, signal);
        if (htmlRes.ok && typeof caches !== "undefined") {
            const navCache = await caches.open(READER_HTML_CACHE);
            await navCache.put(new Request(readerHref, { credentials: "same-origin" }), htmlRes.clone());
        }
    } catch {
        // Non-fatal — reader HTML can be re-fetched next time the user is online.
    }

    // Best-effort: warm the three reader-side APIs the reader view fetches on
    // mount (series metadata, chapter list, per-chapter reader state). Without
    // this, a pinned-but-never-opened chapter would render offline with empty
    // series title, no prev/next navigation, and default reader preferences.
    // These fetches go through the SW's networkFirst API_CACHE strategy, so
    // a successful response is cached automatically.
    const readerApiUrls = buildReaderPrecacheUrls(input);
    await Promise.all(
        readerApiUrls.map(async (href) => {
            try {
                await fetchWithAbort(href, signal);
            } catch {
                // Non-fatal — reader will re-fetch on next online load.
            }
        }),
    );

    const totalPages = pages.length;
    let loadedPages = 0;
    let failedPages = 0;
    let bytesSoFar = 0;
    const reportedPageUrls: string[] = [];

    onProgress?.({ loadedPages, totalPages, bytesSoFar });

    const tasks: Array<() => Promise<void>> = pages.map((page) => async () => {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        try {
            const response = await fetchWithAbort(page.imageUrl, signal);
            if (!response.ok) {
                failedPages += 1;
                return;
            }
            // Consume the body so the underlying connection can be freed.
            // Without this, iOS Safari accumulates unconsumed streams in
            // memory which can crash the PWA when caching large chapters.
            // Use blob.size as fallback when Content-Length is absent
            // (chunked encoding, SW cache hits, etc.) for accurate byte tracking.
            const headerBytes = getResponseBytes(response);
            try {
                const blob = await response.blob();
                bytesSoFar += headerBytes || blob.size;
            } catch {
                bytesSoFar += headerBytes;
            }
            loadedPages += 1;
            reportedPageUrls.push(page.imageUrl);
            onProgress?.({ loadedPages, totalPages, bytesSoFar });
        } catch (error) {
            if (signal?.aborted) throw error;
            failedPages += 1;
        }
    });

    // Simple bounded parallelism with a worker-pool pattern.
    // `workerAborted` ensures all workers drain quickly once one throws
    // (e.g., AbortError), preventing extra fetches after cancellation.
    const queue = [...tasks];
    const workers: Promise<void>[] = [];
    let workerAborted = false;
    const workerCount = Math.max(1, Math.min(concurrency, queue.length));
    for (let i = 0; i < workerCount; i++) {
        workers.push(
            (async () => {
                while (queue.length > 0 && !workerAborted) {
                    const next = queue.shift();
                    if (!next) return;
                    try {
                        await next();
                    } catch (error) {
                        workerAborted = true;
                        throw error;
                    }
                }
            })(),
        );
    }
    try {
        await Promise.all(workers);
    } catch (error) {
        // An abort bubbles up here. Persist what we have so the /cache page
        // can display a partial/failed entry rather than leaving a stale
        // "pending".
        const abortedEntry: CachedChapterEntry = {
            ...pendingEntry,
            pageCount: totalPages,
            pageUrls: reportedPageUrls,
            bytes: bytesSoFar,
            state: "failed",
            updatedAt: Date.now(),
            error: error instanceof Error ? error.message : "Aborted",
        };
        try {
            await putCachedChapter(abortedEntry);
        } catch {
            // ignore
        }
        throw error;
    }

    const finalState: CachedChapterEntry["state"] =
        loadedPages === totalPages ? "ready" : loadedPages > 0 ? "partial" : "failed";

    const finalEntry: CachedChapterEntry = {
        ...pendingEntry,
        pageCount: totalPages,
        pageUrls: reportedPageUrls,
        bytes: bytesSoFar,
        state: finalState,
        updatedAt: Date.now(),
        error: failedPages > 0 ? `${failedPages} page(s) failed to cache` : null,
    };
    try {
        await putCachedChapter(finalEntry);
    } catch {
        // ignore — the result is still returned to the caller
    }

    return {
        entry: finalEntry,
        fetchedPages: loadedPages,
        failedPages,
        bytes: bytesSoFar,
    };
}

/**
 * Remove a chapter from the device cache: drop its images from the
 * service worker's media cache, drop the reader HTML from the nav cache,
 * and delete the IDB entry.
 */
export async function removeChapterFromDevice(
    seriesId: string,
    chapterId: string,
): Promise<{ removedFromCache: number }> {
    const entries = await listCachedChaptersForSeries(seriesId).catch(() => []);
    const entry = entries.find((candidate) => candidate.chapterId === chapterId) ?? null;

    let removedFromCache = 0;
    if (typeof caches !== "undefined") {
        try {
            const mediaCache = await caches.open(buildMediaCacheName());
            if (entry) {
                for (const url of entry.pageUrls) {
                    // ignoreVary: the SW may have cached responses with a
                    // Vary header (e.g. Vary:Accept from image CDNs). Without
                    // this flag the delete fails silently, leaving orphaned entries.
                    const ok = await mediaCache.delete(
                        new Request(url, { credentials: "same-origin" }),
                        { ignoreVary: true },
                    );
                    if (ok) removedFromCache += 1;
                }
            }
        } catch {
            // ignore — Cache API unavailable
        }
        try {
            const navCache = await caches.open(READER_HTML_CACHE);
            const readerHref = buildReaderHref({
                seriesId,
                chapterId,
                sourceName: entry?.sourceName ?? null,
            });
            await navCache.delete(new Request(readerHref, { credentials: "same-origin" }), { ignoreVary: true });
        } catch {
            // ignore
        }
        try {
            const apiCache = await caches.open(CHAPTER_PAGES_API_CACHE);
            const pagesUrl = buildChapterPagesUrl({
                seriesId,
                chapterId,
                sourceName: entry?.sourceName ?? null,
            });
            await apiCache.delete(new Request(pagesUrl, { credentials: "same-origin" }), { ignoreVary: true });
        } catch {
            // ignore
        }
    }

    try {
        await deleteCachedChapter(seriesId, chapterId);
    } catch {
        // ignore
    }

    return { removedFromCache };
}

function buildMediaCacheName(): string {
    return `${SW_CACHE_PREFIX}-media`;
}

/**
 * Returns the set of sourceChapterIds for a given series that are present in
 * the device cache and readable (ready or partial). Used by the series page
 * to mark chapters with a "cached" badge.
 */
export async function getCachedChapterIdsForSeries(seriesId: string): Promise<Set<string>> {
    try {
        return await getCachedChapterIds(seriesId);
    } catch {
        return new Set<string>();
    }
}

/**
 * Returns the full list of cached chapters across the device. Used by the
 * /cache page to render the storage summary and chapter list.
 */
export async function listAllCachedChapters(): Promise<CachedChapterEntry[]> {
    try {
        return await listCachedChapters();
    } catch {
        return [];
    }
}
