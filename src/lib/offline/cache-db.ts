/**
 * Tiny IndexedDB wrapper for the on-device chapter cache registry.
 *
 * This is intentionally separate from the server-side "downloads" system in
 * `src/lib/offline/state.ts`: that system stores bytes on the server's disk
 * so scraping can be skipped. This module stores metadata about what the
 * current iOS/desktop PWA install has warmed into the browser's Cache Storage,
 * so the reader can work offline without needing the server at all.
 *
 * Entries mirror the shape the /cache page needs: enough metadata to render
 * a chapter row (title, chapter number, series cover) without a server call.
 */

const DB_NAME = "tachyon-cache";
const DB_VERSION = 1;
const CHAPTERS_STORE = "chapters";

export type CachedChapterState = "pending" | "ready" | "partial" | "failed";

export interface CachedChapterEntry {
    key: string; // `${seriesId}::${chapterId}`
    seriesId: string;
    sourceName: string | null;
    chapterId: string;
    chapterNo: number;
    title: string;
    seriesTitle: string | null;
    seriesCoverUrl: string | null;
    pageCount: number;
    pageUrls: string[];
    bytes: number;
    state: CachedChapterState;
    cachedAt: number;
    updatedAt: number;
    error: string | null;
}

export function makeCacheKey(seriesId: string, chapterId: string): string {
    return `${seriesId}::${chapterId}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function isBrowserWithIdb(): boolean {
    return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
    if (!isBrowserWithIdb()) {
        return Promise.reject(new Error("IndexedDB is not available in this environment"));
    }
    if (dbPromise) return dbPromise;

    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(CHAPTERS_STORE)) {
                const store = db.createObjectStore(CHAPTERS_STORE, { keyPath: "key" });
                store.createIndex("seriesId", "seriesId", { unique: false });
                store.createIndex("updatedAt", "updatedAt", { unique: false });
            }
        };
        request.onerror = () => {
            dbPromise = null; // allow retry on next call
            reject(request.error ?? new Error("Failed to open cache DB"));
        };
        request.onsuccess = () => {
            const db = request.result;
            // Reset the singleton when the connection is closed unexpectedly
            // (e.g., iOS Safari backgrounding the PWA, or another tab
            // upgrading the DB version). Without this, all subsequent IDB
            // operations would silently fail on the dead handle.
            db.onversionchange = () => {
                db.close();
                dbPromise = null;
            };
            db.onclose = () => {
                dbPromise = null;
            };
            resolve(db);
        };
    });

    return dbPromise;
}

function txPromise<T>(
    mode: IDBTransactionMode,
    runner: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
    return openDb().then(
        (db) =>
            new Promise<T>((resolve, reject) => {
                const tx = db.transaction(CHAPTERS_STORE, mode);
                const store = tx.objectStore(CHAPTERS_STORE);
                let result: T | undefined;
                try {
                    const request = runner(store);
                    request.onsuccess = () => {
                        result = request.result as T;
                    };
                    request.onerror = () => reject(request.error ?? new Error("IDB request failed"));
                } catch (error) {
                    reject(error);
                    return;
                }
                tx.oncomplete = () => resolve(result as T);
                tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
                tx.onabort = () => reject(tx.error ?? new Error("IDB transaction aborted"));
            }),
    );
}

export async function putCachedChapter(entry: CachedChapterEntry): Promise<void> {
    await txPromise<IDBValidKey>("readwrite", (store) => store.put(entry));
}

export async function getCachedChapter(
    seriesId: string,
    chapterId: string,
): Promise<CachedChapterEntry | null> {
    const key = makeCacheKey(seriesId, chapterId);
    const value = await txPromise<CachedChapterEntry | undefined>("readonly", (store) => store.get(key));
    return value ?? null;
}

export async function deleteCachedChapter(seriesId: string, chapterId: string): Promise<void> {
    const key = makeCacheKey(seriesId, chapterId);
    await txPromise<undefined>("readwrite", (store) => store.delete(key));
}

export async function listCachedChapters(): Promise<CachedChapterEntry[]> {
    return txPromise<CachedChapterEntry[]>("readonly", (store) => store.getAll());
}

export async function listCachedChaptersForSeries(seriesId: string): Promise<CachedChapterEntry[]> {
    return txPromise<CachedChapterEntry[]>("readonly", (store) => {
        const index = store.index("seriesId");
        return index.getAll(IDBKeyRange.only(seriesId));
    });
}

export async function getCachedChapterIds(seriesId: string): Promise<Set<string>> {
    const entries = await listCachedChaptersForSeries(seriesId);
    const ids = new Set<string>();
    for (const entry of entries) {
        if (entry.state === "ready" || entry.state === "partial") {
            ids.add(entry.chapterId);
        }
    }
    return ids;
}

/**
 * Test helper: resets the in-memory singleton. The database itself is not
 * dropped; callers that want a clean slate should delete the database via
 * `indexedDB.deleteDatabase(DB_NAME)` in a test fixture.
 */
export function __resetCacheDbForTests(): void {
    dbPromise = null;
}

export const __CACHE_DB_META__ = { DB_NAME, DB_VERSION, CHAPTERS_STORE };
