import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetCacheDbForTests } from "./cache-db";
import { enqueueProgress, flushOutbox, getOutboxCount } from "./outbox";

// Wipe the fake IDB between tests so each one starts clean. The singleton
// connection lives inside cache-db.ts so we also reset that.
function resetAll() {
    __resetCacheDbForTests();
    const req = indexedDB.deleteDatabase("tachyon-cache");
    return new Promise<void>((resolve) => {
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
    });
}

function body(seriesId: string, chapterId: string, currentPage: number): string {
    return JSON.stringify({ seriesId, chapterId, currentPage });
}

describe("outbox", () => {
    beforeEach(async () => {
        await resetAll();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await resetAll();
    });

    it("coalesces per chapter — newest body wins", async () => {
        await enqueueProgress({ chapterKey: "s1::c1", body: body("s1", "c1", 1) });
        await enqueueProgress({ chapterKey: "s1::c1", body: body("s1", "c1", 2) });
        await enqueueProgress({ chapterKey: "s1::c1", body: body("s1", "c1", 3) });

        expect(await getOutboxCount()).toBe(1);

        const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
            new Response(null, { status: 200 }),
        );
        vi.stubGlobal("fetch", fetchMock);

        await flushOutbox();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/api/reader/state");
        const sent = JSON.parse(init!.body as string);
        expect(sent.currentPage).toBe(3);
    });

    it("keeps entries for different chapters distinct", async () => {
        await enqueueProgress({ chapterKey: "s1::c1", body: body("s1", "c1", 5) });
        await enqueueProgress({ chapterKey: "s1::c2", body: body("s1", "c2", 7) });
        expect(await getOutboxCount()).toBe(2);
    });

    it("removes entries on 2xx", async () => {
        await enqueueProgress({ chapterKey: "s1::c1", body: body("s1", "c1", 9) });

        const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
        vi.stubGlobal("fetch", fetchMock);

        const result = await flushOutbox();
        expect(result.succeeded).toBe(1);
        expect(await getOutboxCount()).toBe(0);
    });

    it("drops on 4xx (bad payload — retrying won't help)", async () => {
        await enqueueProgress({ chapterKey: "s1::c1", body: body("s1", "c1", 9) });

        const fetchMock = vi.fn(async () => new Response(null, { status: 400 }));
        vi.stubGlobal("fetch", fetchMock);

        const result = await flushOutbox();
        expect(result.failed).toBe(1);
        expect(await getOutboxCount()).toBe(0);
    });

    it("retains on 5xx and stops flushing to avoid hammering server", async () => {
        await enqueueProgress({ chapterKey: "s1::c1", body: body("s1", "c1", 1) });
        await enqueueProgress({ chapterKey: "s1::c2", body: body("s1", "c2", 2) });
        await enqueueProgress({ chapterKey: "s1::c3", body: body("s1", "c3", 3) });

        const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
        vi.stubGlobal("fetch", fetchMock);

        const result = await flushOutbox();
        expect(result.failed).toBe(1);
        // Only the first entry is attempted — after it fails with a 5xx we
        // stop so a broken server isn't hit N more times.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(await getOutboxCount()).toBe(3);
    });

    it("retains on network throw and breaks the loop", async () => {
        await enqueueProgress({ chapterKey: "s1::c1", body: body("s1", "c1", 1) });
        await enqueueProgress({ chapterKey: "s1::c2", body: body("s1", "c2", 2) });

        const fetchMock = vi.fn(async () => {
            throw new TypeError("Failed to fetch");
        });
        vi.stubGlobal("fetch", fetchMock);

        const result = await flushOutbox();
        expect(result.failed).toBe(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(await getOutboxCount()).toBe(2);
    });

    it("flushes in insertion order (oldest first)", async () => {
        await enqueueProgress({ chapterKey: "s1::c1", body: body("s1", "c1", 1) });
        await enqueueProgress({ chapterKey: "s1::c2", body: body("s1", "c2", 2) });
        await enqueueProgress({ chapterKey: "s1::c3", body: body("s1", "c3", 3) });

        const seen: string[] = [];
        const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
            seen.push(init.body as string);
            return new Response(null, { status: 200 });
        });
        vi.stubGlobal("fetch", fetchMock);

        await flushOutbox();

        expect(seen.map((b) => JSON.parse(b).chapterId)).toEqual(["c1", "c2", "c3"]);
    });

    it("flushOutbox is a singleton — parallel callers see the same result", async () => {
        await enqueueProgress({ chapterKey: "s1::c1", body: body("s1", "c1", 1) });

        const fetchMock = vi.fn(async () => {
            await new Promise((r) => setTimeout(r, 10));
            return new Response(null, { status: 200 });
        });
        vi.stubGlobal("fetch", fetchMock);

        const [a, b] = await Promise.all([flushOutbox(), flushOutbox()]);
        expect(a).toEqual(b);
        // Only one real drain happened despite two callers.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
