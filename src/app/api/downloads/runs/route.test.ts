import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listRunsMock = vi.fn();
const listActiveRunsMock = vi.fn();
const listTasksForRunsMock = vi.fn();
const listTasksForRunMock = vi.fn();
const enqueueSingleChapterDownloadMock = vi.fn();
const enqueueDownloadChaptersMock = vi.fn();
const enqueueBulkDownloadMock = vi.fn();
const enqueueDeleteReadDownloadsMock = vi.fn();
const getBackgroundSettingsMock = vi.fn();

vi.mock("@/lib/background/queue", () => ({
  listRuns: listRunsMock,
  listActiveRuns: listActiveRunsMock,
  listTasksForRuns: listTasksForRunsMock,
  listTasksForRun: listTasksForRunMock,
}));

vi.mock("@/lib/background/enqueue", () => ({
  enqueueSingleChapterDownload: enqueueSingleChapterDownloadMock,
  enqueueDownloadChapters: enqueueDownloadChaptersMock,
  enqueueBulkDownload: enqueueBulkDownloadMock,
  enqueueDeleteReadDownloads: enqueueDeleteReadDownloadsMock,
}));

vi.mock("@/lib/background/settings", () => ({
  getBackgroundSettings: getBackgroundSettingsMock,
}));

describe("downloads runs API", () => {
  beforeEach(() => {
    listRunsMock.mockReset();
    listActiveRunsMock.mockReset();
    listActiveRunsMock.mockReturnValue([]);
    listTasksForRunsMock.mockReset();
    listTasksForRunMock.mockReset();
    listTasksForRunMock.mockReturnValue([]);
    enqueueSingleChapterDownloadMock.mockReset();
    enqueueDownloadChaptersMock.mockReset();
    enqueueBulkDownloadMock.mockReset();
    enqueueDeleteReadDownloadsMock.mockReset();
    getBackgroundSettingsMock.mockReset();
    getBackgroundSettingsMock.mockReturnValue({ autoDeleteKeepLastN: 5 });
  });

  it("lists runs", async () => {
    listRunsMock.mockReturnValue([{ id: "run-1" }]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/downloads/runs"));

    expect(listRunsMock).toHaveBeenCalledWith("download", {
      limit: 50,
      status: undefined,
      sourceSeriesId: undefined,
    });
    await expect(response.json()).resolves.toEqual({ runs: [{ id: "run-1" }] });
  });

  it("lists runs with tasks when includeTasks=true", async () => {
    listRunsMock.mockReturnValue([{ id: "run-1" }, { id: "run-2" }]);
    listTasksForRunsMock.mockImplementation((runIds: string[]) => {
      const map = new Map<string, Array<{ id: string }>>();
      for (const id of runIds) {
        map.set(id, [{ id: `${id}-task` }]);
      }
      return map;
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/downloads/runs?includeTasks=true"));

    expect(listTasksForRunsMock).toHaveBeenCalledWith(["run-1", "run-2"]);
    const body = (await response.json()) as { runs: unknown[] };
    expect(body.runs).toHaveLength(2);
    expect(body.runs[0]).toMatchObject({ id: "run-1", tasks: [{ id: "run-1-task" }] });
    expect(body.runs[1]).toMatchObject({ id: "run-2", tasks: [{ id: "run-2-task" }] });
  });

  it("supports status and series filters", async () => {
    listRunsMock.mockReturnValue([]);

    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/downloads/runs?status=failed&seriesId=s99&limit=20"));

    expect(listRunsMock).toHaveBeenCalledWith("download", {
      limit: 20,
      status: "failed",
      sourceSeriesId: "s99",
    });
  });

  it("falls back for invalid status and limit", async () => {
    listRunsMock.mockReturnValue([]);

    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/downloads/runs?status=bogus&limit=NaN"));

    expect(listRunsMock).toHaveBeenCalledWith("download", {
      limit: 50,
      status: undefined,
      sourceSeriesId: undefined,
    });
  });

  it("returns active run count without applying list limit", async () => {
    listActiveRunsMock.mockReturnValue([{ id: "r1" }, { id: "r2" }, { id: "r3" }]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/downloads/runs?activeOnly=true&countOnly=true"));

    expect(listActiveRunsMock).toHaveBeenCalledWith("download");
    expect(listRunsMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ count: 3 });
  });

  it("validates action and seriesId", async () => {
    const { POST } = await import("./route");

    const missingAction = await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ seriesId: "s1" }),
      }),
    );
    expect(missingAction.status).toBe(400);
    await expect(missingAction.json()).resolves.toEqual({ error: "action is required" });

    const missingSeries = await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ action: "bulk" }),
      }),
    );
    expect(missingSeries.status).toBe(400);
    await expect(missingSeries.json()).resolves.toEqual({ error: "seriesId is required" });
  });

  it("enqueues single chapter runs", async () => {
    enqueueSingleChapterDownloadMock.mockReturnValue({ id: "run-pin" });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ action: "chapter", seriesId: "s1", chapterId: "c1" }),
      }),
    );

    expect(enqueueSingleChapterDownloadMock).toHaveBeenCalledWith({
      sourceSeriesId: "s1",
      sourceChapterId: "c1",
      trigger: "manual",
    });
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      runId: "run-pin",
      run: { id: "run-pin" },
    });
  });

  it("validates chapter action payload", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ action: "chapter", seriesId: "s1" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "chapterId is required" });
  });

  it("enqueues explicit chapter lists", async () => {
    enqueueDownloadChaptersMock.mockReturnValue({ id: "run-chapters" });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({
          action: "chapters",
          seriesId: "s1",
          chapterIds: ["c1", "c2", "c2"],
        }),
      }),
    );

    expect(enqueueDownloadChaptersMock).toHaveBeenCalledWith({
      sourceSeriesId: "s1",
      chapterIds: ["c1", "c2", "c2"],
      trigger: "manual",
      reason: "manual:chapters",
    });
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      runId: "run-chapters",
      run: { id: "run-chapters" },
    });
  });

  it("validates explicit chapter list payload", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ action: "chapters", seriesId: "s1", chapterIds: [] }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "chapterIds is required" });
  });

  it("enqueues bulk runs", async () => {
    enqueueBulkDownloadMock.mockResolvedValue({ id: "run-bulk" });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ action: "bulk", seriesId: "s1", scope: "next50" }),
      }),
    );

    expect(enqueueBulkDownloadMock).toHaveBeenCalledWith({
      sourceSeriesId: "s1",
      scope: "next50",
      trigger: "manual",
    });
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      runId: "run-bulk",
      run: { id: "run-bulk" },
    });
  });

  it("maps series action to full-scope bulk", async () => {
    enqueueBulkDownloadMock.mockResolvedValue({ id: "run-series" });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ action: "series", seriesId: "s1" }),
      }),
    );

    expect(enqueueBulkDownloadMock).toHaveBeenCalledWith({
      sourceSeriesId: "s1",
      scope: "all",
      trigger: "manual",
    });
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      runId: "run-series",
      run: { id: "run-series" },
    });
  });

  it("validates invalid bulk scope", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ action: "bulk", seriesId: "s1", scope: "later" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "scope must be one of: all, unread, next50, next100",
    });
  });

  it("enqueues delete-read action with explicit keepLastN", async () => {
    enqueueDeleteReadDownloadsMock.mockReturnValue({ id: "run-delete" });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ action: "deleteRead", seriesId: "s1", keepLastN: 12 }),
      }),
    );

    expect(enqueueDeleteReadDownloadsMock).toHaveBeenCalledWith({
      sourceSeriesId: "s1",
      keepLastN: 12,
      trigger: "manual",
      reason: "manual:deleteRead",
    });
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      runId: "run-delete",
      run: { id: "run-delete" },
    });
  });

  it("uses default keepLastN from settings for delete-read action", async () => {
    enqueueDeleteReadDownloadsMock.mockReturnValue({ id: "run-delete-default" });

    const { POST } = await import("./route");
    await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ action: "deleteRead", seriesId: "s1" }),
      }),
    );

    expect(enqueueDeleteReadDownloadsMock).toHaveBeenCalledWith({
      sourceSeriesId: "s1",
      keepLastN: 5,
      trigger: "manual",
      reason: "manual:deleteRead",
    });
  });

  it("returns bad request for unknown action", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ action: "unknown", seriesId: "s1" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Unknown action" });
  });

  it("retries failed tasks in a run", async () => {
    listTasksForRunMock.mockReturnValue([
      { id: "t1", state: "failed", sourceSeriesId: "s1", sourceChapterId: "c1" },
      { id: "t2", state: "failed", sourceSeriesId: "s1", sourceChapterId: "c2" },
      { id: "t3", state: "succeeded", sourceSeriesId: "s1", sourceChapterId: "c3" },
    ]);
    enqueueDownloadChaptersMock.mockReturnValue({ id: "run-retry" });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ action: "retryFailed", runId: "run-old" }),
      }),
    );

    expect(listTasksForRunMock).toHaveBeenCalledWith("run-old", { limit: 500, offset: 0 });
    expect(enqueueDownloadChaptersMock).toHaveBeenCalledWith({
      sourceSeriesId: "s1",
      chapterIds: ["c1", "c2"],
      trigger: "manual",
      reason: "retry:failed",
    });
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      runId: "run-retry",
      run: { id: "run-retry" },
    });
  });

  it("returns accepted with no run when no failed tasks exist", async () => {
    listTasksForRunMock.mockReturnValue([
      { id: "t1", state: "succeeded", sourceSeriesId: "s1", sourceChapterId: "c1" },
    ]);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ action: "retryFailed", runId: "run-old" }),
      }),
    );

    expect(enqueueDownloadChaptersMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ accepted: true, runId: null, run: null });
  });

  it("paginates when retrying failed tasks", async () => {
    listTasksForRunMock
      .mockReturnValueOnce(
        Array.from({ length: 500 }, (_, i) => ({
          id: `t-${i}`,
          state: "failed",
          sourceSeriesId: "s1",
          sourceChapterId: `c-${i}`,
        })),
      )
      .mockReturnValueOnce([
        { id: "t-500", state: "failed", sourceSeriesId: "s1", sourceChapterId: "c-500" },
      ]);
    enqueueDownloadChaptersMock.mockReturnValue({ id: "run-retry-large" });

    const { POST } = await import("./route");
    await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ action: "retryFailed", runId: "run-old" }),
      }),
    );

    expect(listTasksForRunMock).toHaveBeenNthCalledWith(1, "run-old", { limit: 500, offset: 0 });
    expect(listTasksForRunMock).toHaveBeenNthCalledWith(2, "run-old", { limit: 500, offset: 500 });
    expect(enqueueDownloadChaptersMock).toHaveBeenCalledWith({
      sourceSeriesId: "s1",
      chapterIds: expect.arrayContaining(["c-0", "c-499", "c-500"]),
      trigger: "manual",
      reason: "retry:failed",
    });
  });

  it("requires runId for retryFailed action", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/downloads/runs", {
        method: "POST",
        body: JSON.stringify({ action: "retryFailed" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "runId is required" });
  });
});
