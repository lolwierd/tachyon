import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getOfflineOverviewMock = vi.fn();
const pinChapterMock = vi.fn();
const unpinChapterMock = vi.fn();
const pinSeriesMock = vi.fn();
const cleanupUnpinnedCacheMock = vi.fn();
const deleteReadChaptersMock = vi.fn();

vi.mock("@/lib/offline/state", () => ({
    getOfflineOverview: getOfflineOverviewMock,
    pinChapter: pinChapterMock,
    unpinChapter: unpinChapterMock,
    pinSeries: pinSeriesMock,
    cleanupUnpinnedCache: cleanupUnpinnedCacheMock,
    deleteReadChapters: deleteReadChaptersMock,
}));

describe("offline API", () => {
    beforeEach(() => {
        getOfflineOverviewMock.mockReset();
        pinChapterMock.mockReset();
        unpinChapterMock.mockReset();
        pinSeriesMock.mockReset();
        cleanupUnpinnedCacheMock.mockReset();
        deleteReadChaptersMock.mockReset();
    });

    it("returns cache overview", async () => {
        getOfflineOverviewMock.mockResolvedValue({ storage: { cacheBytes: 100 }, chapters: [] });

        const { GET } = await import("./route");
        const response = await GET(new Request("http://localhost/api/offline?seriesId=series-1"));

        expect(getOfflineOverviewMock).toHaveBeenCalledWith("series-1");
        await expect(response.json()).resolves.toEqual({
            storage: { cacheBytes: 100 },
            chapters: [],
        });
    });

    it("validates required chapter payload fields", async () => {
        const { POST } = await import("./route");
        const response = await POST(
            new NextRequest("http://localhost/api/offline", {
                method: "POST",
                body: JSON.stringify({ action: "pinChapter", seriesId: "series-1" }),
            }),
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({
            error: "seriesId and chapterId are required",
        });
    });

    it("pins and unpins chapters", async () => {
        pinChapterMock.mockResolvedValue({ sourceChapterId: "ch-1", state: "ready" });
        unpinChapterMock.mockResolvedValue({ sourceChapterId: "ch-1", removedFiles: 3 });

        const { POST } = await import("./route");
        const pinResponse = await POST(
            new NextRequest("http://localhost/api/offline", {
                method: "POST",
                body: JSON.stringify({
                    action: "pinChapter",
                    seriesId: "series-1",
                    chapterId: "ch-1",
                }),
            }),
        );

        expect(pinChapterMock).toHaveBeenCalledWith("series-1", "ch-1");
        await expect(pinResponse.json()).resolves.toEqual({ sourceChapterId: "ch-1", state: "ready" });

        const unpinResponse = await POST(
            new NextRequest("http://localhost/api/offline", {
                method: "POST",
                body: JSON.stringify({
                    action: "unpinChapter",
                    seriesId: "series-1",
                    chapterId: "ch-1",
                }),
            }),
        );

        expect(unpinChapterMock).toHaveBeenCalledWith("series-1", "ch-1");
        await expect(unpinResponse.json()).resolves.toEqual({ sourceChapterId: "ch-1", removedFiles: 3 });
    });

    it("handles pin series and cleanup actions", async () => {
        pinSeriesMock.mockResolvedValue({ sourceSeriesId: "series-1", pinned: 12, failures: [] });
        cleanupUnpinnedCacheMock.mockResolvedValue({ removedFiles: 5, removedBytes: 2048 });

        const { POST } = await import("./route");
        const pinResponse = await POST(
            new NextRequest("http://localhost/api/offline", {
                method: "POST",
                body: JSON.stringify({ action: "pinSeries", seriesId: "series-1" }),
            }),
        );

        expect(pinSeriesMock).toHaveBeenCalledWith("series-1");
        await expect(pinResponse.json()).resolves.toEqual({
            sourceSeriesId: "series-1",
            pinned: 12,
            failures: [],
        });

        const cleanupResponse = await POST(
            new NextRequest("http://localhost/api/offline", {
                method: "POST",
                body: JSON.stringify({ action: "cleanup", maxAgeDays: 3 }),
            }),
        );

        expect(cleanupUnpinnedCacheMock).toHaveBeenCalledWith(3);
        await expect(cleanupResponse.json()).resolves.toEqual({ removedFiles: 5, removedBytes: 2048 });
    });

    it("deletes read chapter downloads for a series", async () => {
        deleteReadChaptersMock.mockResolvedValue({
            sourceSeriesId: "series-1",
            requested: 2,
            deleted: 2,
            removedFiles: 24,
            failures: [],
        });

        const { POST } = await import("./route");
        const response = await POST(
            new NextRequest("http://localhost/api/offline", {
                method: "POST",
                body: JSON.stringify({ action: "deleteReadChapters", seriesId: "series-1" }),
            }),
        );

        expect(deleteReadChaptersMock).toHaveBeenCalledWith("series-1");
        await expect(response.json()).resolves.toEqual({
            sourceSeriesId: "series-1",
            requested: 2,
            deleted: 2,
            removedFiles: 24,
            failures: [],
        });
    });
});
