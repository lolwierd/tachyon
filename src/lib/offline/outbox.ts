// Write outbox for reader-state progress saves that happen while offline.
//
// Design rationale:
//   * When online, reader-view.tsx POSTs to /api/reader/state as usual. No
//     IDB involvement.
//   * When offline (either real network or manual toggle), or when a POST
//     fails with a network/5xx, the payload lands here. On the next online
//     transition the context layer drains this store back to the server in
//     insertion order.
//   * A single chapter can be read through many pages in a short span, each
//     firing a progress save. Rather than keep every intermediate page, we
//     coalesce per-chapter: the newest payload for a chapterKey wins. This
//     keeps the outbox small and flush cheap.
//   * Flush is sequential so the server sees progress in the order the user
//     actually read. Parallelizing would risk an older entry overwriting a
//     newer one if the server orders by write time rather than payload.

import { OUTBOX_STORE_NAME, runTx } from "./cache-db";

export interface OutboxEntry {
    id?: number;
    chapterKey: string; // `${seriesId}::${chapterId}` — dedupe / coalesce key
    body: string; // pre-stringified JSON payload for /api/reader/state
    createdAt: number;
}

type Listener = (count: number) => void;
const listeners = new Set<Listener>();

function notifyListeners(count: number) {
    for (const listener of listeners) {
        try {
            listener(count);
        } catch {
            // one bad listener shouldn't wedge the rest
        }
    }
}

export function subscribeOutbox(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

async function publishCount(): Promise<number> {
    const count = await getOutboxCount();
    notifyListeners(count);
    return count;
}

export async function getOutboxCount(): Promise<number> {
    try {
        return await runTx<number>(OUTBOX_STORE_NAME, "readonly", (store) => store.count());
    } catch {
        return 0;
    }
}

// Per-chapter coalescing: before writing, drop any older queued entries with
// the same chapterKey. The caller already holds the most recent page state;
// previous queued writes for the same chapter are strictly obsolete.
async function deleteEntriesForChapter(chapterKey: string): Promise<void> {
    return new Promise((resolve) => {
        void runTx<IDBValidKey[]>(OUTBOX_STORE_NAME, "readwrite", (store) => {
            const index = store.index("chapterKey");
            const req = index.openCursor(IDBKeyRange.only(chapterKey));
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
            // Return a dummy completed request so runTx's tx.oncomplete fires.
            return store.getAllKeys();
        })
            .then(() => resolve())
            .catch(() => resolve());
    });
}

export async function enqueueProgress(entry: Omit<OutboxEntry, "id" | "createdAt">): Promise<void> {
    try {
        await deleteEntriesForChapter(entry.chapterKey);
        const payload: OutboxEntry = {
            chapterKey: entry.chapterKey,
            body: entry.body,
            createdAt: Date.now(),
        };
        await runTx<IDBValidKey>(OUTBOX_STORE_NAME, "readwrite", (store) => store.add(payload));
    } catch {
        // IDB unavailable (private mode, etc). There's nothing sensible we
        // can do — we'd rather lose the single progress save than crash the
        // reader. Online mode is unaffected; this only matters offline.
    } finally {
        await publishCount();
    }
}

async function listAllEntries(): Promise<OutboxEntry[]> {
    try {
        return await runTx<OutboxEntry[]>(OUTBOX_STORE_NAME, "readonly", (store) => store.getAll());
    } catch {
        return [];
    }
}

async function removeEntry(id: number): Promise<void> {
    try {
        await runTx<undefined>(OUTBOX_STORE_NAME, "readwrite", (store) => store.delete(id));
    } catch {
        // Entry is stale either way — if delete failed, the next flush will
        // try again and the server should be idempotent on repeat payloads.
    }
}

export interface FlushResult {
    attempted: number;
    succeeded: number;
    failed: number;
}

let flushInFlight: Promise<FlushResult> | null = null;

export async function flushOutbox(): Promise<FlushResult> {
    // Singleton: multiple components (context effect + manual button) can
    // race on flush. Only one real drain runs at a time; parallel callers
    // await the same promise and see identical results.
    if (flushInFlight) return flushInFlight;

    flushInFlight = (async () => {
        const entries = await listAllEntries();
        entries.sort((a, b) => a.createdAt - b.createdAt);
        const result: FlushResult = { attempted: 0, succeeded: 0, failed: 0 };
        for (const entry of entries) {
            if (entry.id === undefined) continue;
            result.attempted += 1;
            try {
                const res = await fetch("/api/reader/state", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: entry.body,
                    credentials: "same-origin",
                });
                if (res.ok) {
                    await removeEntry(entry.id);
                    result.succeeded += 1;
                } else {
                    // A 4xx means the payload is bad; retrying won't help,
                    // so drop it. A 5xx might be transient — leave it.
                    if (res.status >= 400 && res.status < 500) {
                        await removeEntry(entry.id);
                    }
                    result.failed += 1;
                }
            } catch {
                // Network failure; leave the entry in place for the next
                // flush trigger.
                result.failed += 1;
                break; // no point hammering offline; retry on next online event
            }
        }
        await publishCount();
        return result;
    })();

    try {
        return await flushInFlight;
    } finally {
        flushInFlight = null;
    }
}
