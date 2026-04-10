import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getOfflineOverviewMock = vi.fn();
const unpinChapterMock = vi.fn();
const cleanupUnpinnedCacheMock = vi.fn();

const enqueueSingleChapterDownloadMock = vi.fn();
const enqueueBulkDownloadMock = vi.fn();
const enqueueDeleteReadDownloadsMock = vi.fn();
const getBackgroundSettingsMock = vi.fn();

vi.mock("@/lib/offline/state", () => ({
  getOfflineOverview: getOfflineOverviewMock,
  unpinChapter: unpinChapterMock,
  cleanupUnpinnedCache: cleanupUnpinnedCacheMock,
}));

vi.mock("@/lib/background/enqueue", () => ({
  enqueueSingleChapterDownload: enqueueSingleChapterDownloadMock,
  enqueueBulkDownload: enqueueBulkDownloadMock,
  enqueueDeleteReadDownloads: enqueueDeleteReadDownloadsMock,
}));

vi.mock("@/lib/background/settings", () => ({
  getBackgroundSettings: getBackgroundSettingsMock,
}));

const SAME_ORIGIN_HEADERS = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
};

function makePostRequest(body: unknown) {
  return new NextRequest("http://localhost/api/offline", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...SAME_ORIGIN_HEADERS,
    },
    body: JSON.stringify(body),
  });
}

describe("offline API", () => {
  beforeEach(() => {
    getOfflineOverviewMock.mockReset();
    unpinChapterMock.mockReset();
    cleanupUnpinnedCacheMock.mockReset();
    enqueueSingleChapterDownloadMock.mockReset();
    enqueueBulkDownloadMock.mockReset();
    enqueueDeleteReadDownloadsMock.mockReset();
    getBackgroundSettingsMock.mockReset();

    getBackgroundSettingsMock.mockReturnValue({ autoDeleteKeepLastN: 5 });
  });

  it("returns cache overview", async () => {
    getOfflineOverviewMock.mockResolvedValue({ storage: { cacheBytes: 100 }, chapters: [] });

    const { GET } = await import("./route");
    const response = (await GET(new Request("http://localhost/api/offline?seriesId=series-1")))!;

    expect(getOfflineOverviewMock).toHaveBeenCalledWith("series-1");
    await expect(response.json()).resolves.toEqual({
      storage: { cacheBytes: 100 },
      chapters: [],
    });
  });

  it("validates required chapter payload fields", async () => {
    const { POST } = await import("./route");
    const response = (await POST(makePostRequest({ action: "pinChapter", seriesId: "series-1" })))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });
  });

  it("enqueues chapter download and keeps unpin synchronous", async () => {
    enqueueSingleChapterDownloadMock.mockReturnValue({ id: "run-pin" });
    unpinChapterMock.mockResolvedValue({ sourceChapterId: "ch-1", removedFiles: 3 });

    const { POST } = await import("./route");
    const pinResponse = (await POST(makePostRequest({
      action: "pinChapter",
      seriesId: "series-1",
      chapterId: "ch-1",
    })))!;

    expect(enqueueSingleChapterDownloadMock).toHaveBeenCalledWith({
      sourceSeriesId: "series-1",
      sourceChapterId: "ch-1",
      trigger: "manual",
    });
    await expect(pinResponse.json()).resolves.toEqual({
      accepted: true,
      runId: "run-pin",
      run: { id: "run-pin" },
    });

    const unpinResponse = (await POST(makePostRequest({
      action: "unpinChapter",
      seriesId: "series-1",
      chapterId: "ch-1",
    })))!;

    expect(unpinChapterMock).toHaveBeenCalledWith("series-1", "ch-1");
    await expect(unpinResponse.json()).resolves.toEqual({ sourceChapterId: "ch-1", removedFiles: 3 });
  });

  it("enqueues series/bulk downloads and cleanup", async () => {
    enqueueBulkDownloadMock
      .mockResolvedValueOnce({ id: "run-series" })
      .mockResolvedValueOnce({ id: "run-bulk" });
    cleanupUnpinnedCacheMock.mockResolvedValue({ removedFiles: 5, removedBytes: 2048 });

    const { POST } = await import("./route");
    const pinSeriesResponse = (await POST(makePostRequest({ action: "pinSeries", seriesId: "series-1" })))!;

    expect(enqueueBulkDownloadMock).toHaveBeenCalledWith({
      sourceSeriesId: "series-1",
      scope: "all",
      trigger: "manual",
    });
    await expect(pinSeriesResponse.json()).resolves.toEqual({
      accepted: true,
      runId: "run-series",
      run: { id: "run-series" },
    });

    const bulkResponse = (await POST(makePostRequest({
      action: "downloadBulk",
      seriesId: "series-1",
      scope: "next50",
    })))!;

    expect(enqueueBulkDownloadMock).toHaveBeenCalledWith({
      sourceSeriesId: "series-1",
      scope: "next50",
      trigger: "manual",
    });
    await expect(bulkResponse.json()).resolves.toEqual({
      accepted: true,
      runId: "run-bulk",
      run: { id: "run-bulk" },
    });

    const cleanupResponse = (await POST(makePostRequest({ action: "cleanup", maxAgeDays: 3 })))!;

    expect(cleanupUnpinnedCacheMock).toHaveBeenCalledWith();
    await expect(cleanupResponse.json()).resolves.toEqual({ removedFiles: 5, removedBytes: 2048 });
  });

  it("enqueues delete read chapter cleanup", async () => {
    enqueueDeleteReadDownloadsMock.mockReturnValue({ id: "run-delete" });

    const { POST } = await import("./route");
    const response = (await POST(makePostRequest({ action: "deleteReadChapters", seriesId: "series-1" })))!;

    expect(enqueueDeleteReadDownloadsMock).toHaveBeenCalledWith({
      sourceSeriesId: "series-1",
      keepLastN: 5,
      trigger: "manual",
      reason: "offline_action",
    });
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      runId: "run-delete",
      run: { id: "run-delete" },
    });
  });
});
