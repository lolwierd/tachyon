import { beforeEach, describe, expect, it, vi } from "vitest";

const listRunsMock = vi.fn();
const listTasksForRunsMock = vi.fn();
const getRunMock = vi.fn();
const enqueueUpdateRunMock = vi.fn();
const getSeriesMappingMock = vi.fn();

vi.mock("@/lib/background/queue", () => ({
  getRun: getRunMock,
  listRuns: listRunsMock,
  listTasksForRuns: listTasksForRunsMock,
}));

vi.mock("@/lib/background/enqueue", () => ({
  enqueueUpdateRun: enqueueUpdateRunMock,
}));

vi.mock("@/lib/library/shared", () => ({
  getSeriesMapping: getSeriesMappingMock,
}));

describe("updates runs API", () => {
  beforeEach(() => {
    listRunsMock.mockReset();
    listRunsMock.mockReturnValue([]);
    listTasksForRunsMock.mockReset();
    getRunMock.mockReset();
    enqueueUpdateRunMock.mockReset();
    getSeriesMappingMock.mockReset();
  });

  it("lists update runs with defaults", async () => {
    listRunsMock.mockReturnValue([{ id: "run-1" }]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/updates/runs"));

    expect(listRunsMock).toHaveBeenCalledWith("update", {
      limit: 50,
      status: undefined,
      sourceSeriesId: undefined,
    });
    await expect(response.json()).resolves.toEqual({ runs: [{ id: "run-1" }] });
  });

  it("supports status and series filtering", async () => {
    listRunsMock.mockReturnValue([{ id: "run-2" }]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/updates/runs?status=failed&seriesId=series-9&limit=20"),
    );

    expect(listRunsMock).toHaveBeenCalledWith("update", {
      limit: 20,
      status: "failed",
      sourceSeriesId: "series-9",
    });
    await expect(response.json()).resolves.toEqual({ runs: [{ id: "run-2" }] });
  });

  it("ignores invalid status and invalid limit", async () => {
    listRunsMock.mockReturnValue([]);

    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/updates/runs?status=bogus&limit=NaN"));

    expect(listRunsMock).toHaveBeenCalledWith("update", {
      limit: 50,
      status: undefined,
      sourceSeriesId: undefined,
    });
  });

  it("includes task lists when requested", async () => {
    listRunsMock.mockReturnValue([{ id: "run-1" }, { id: "run-2" }]);
    listTasksForRunsMock.mockImplementation((runIds: string[]) => {
      const map = new Map<string, Array<{ id: string }>>();
      for (const id of runIds) {
        map.set(id, [{ id: `${id}-task` }]);
      }
      return map;
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/updates/runs?includeTasks=true"));

    expect(listTasksForRunsMock).toHaveBeenCalledWith(["run-1", "run-2"]);
    await expect(response.json()).resolves.toEqual({
      runs: [
        { id: "run-1", tasks: [{ id: "run-1-task" }] },
        { id: "run-2", tasks: [{ id: "run-2-task" }] },
      ],
    });
  });

  it("returns one requested update run", async () => {
    getRunMock.mockReturnValue({ id: "run-3", kind: "update", status: "running" });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/updates/runs?runId=run-3"));

    expect(getRunMock).toHaveBeenCalledWith("run-3");
    expect(listRunsMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      runs: [{ id: "run-3", kind: "update", status: "running" }],
    });
  });

  it("queues an update for one mapped series", async () => {
    listRunsMock.mockReturnValue([]);
    getSeriesMappingMock.mockReturnValue({
      seriesId: "local-series-1",
      sourceSeriesId: "source-series-1",
      source: "oppai",
    });
    enqueueUpdateRunMock.mockReturnValue({ id: "run-3" });

    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/updates/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seriesId: "local-series-1", source: "oppai" }),
    }));

    expect(getSeriesMappingMock).toHaveBeenCalledWith("local-series-1", "oppai");
    expect(enqueueUpdateRunMock).toHaveBeenCalledWith({
      entries: [{ sourceSeriesId: "source-series-1", source: "oppai" }],
      trigger: "manual",
      reason: "series_update",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      alreadyRunning: false,
      runId: "run-3",
      run: { id: "run-3" },
    });
  });

  it("returns the active run instead of creating a duplicate update", async () => {
    getSeriesMappingMock.mockReturnValue({
      seriesId: "local-series-1",
      sourceSeriesId: "source-series-1",
      source: "oppai",
    });
    listRunsMock.mockReturnValueOnce([{
      id: "run-active",
      kind: "update",
      status: "running",
      scope: {
        entries: [{ sourceSeriesId: "source-series-1", source: "oppai" }],
      },
    }]);

    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/updates/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seriesId: "local-series-1", source: "oppai" }),
    }));

    expect(enqueueUpdateRunMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      alreadyRunning: true,
      runId: "run-active",
      run: {
        id: "run-active",
        kind: "update",
        status: "running",
        scope: {
          entries: [{ sourceSeriesId: "source-series-1", source: "oppai" }],
        },
      },
    });
  });

  it("does not reuse an active run from another source with the same series id", async () => {
    getSeriesMappingMock.mockReturnValue({
      seriesId: "local-series-1",
      sourceSeriesId: "shared-slug",
      source: "oppai",
    });
    listRunsMock
      .mockReturnValueOnce([{
        id: "wrong-source-run",
        kind: "update",
        status: "running",
        scope: {
          entries: [{ sourceSeriesId: "shared-slug", source: "weebcentral" }],
        },
      }])
      .mockReturnValueOnce([]);
    enqueueUpdateRunMock.mockReturnValue({ id: "run-oppai", totalTasks: 1 });

    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/updates/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seriesId: "local-series-1", source: "oppai" }),
    }));

    expect(enqueueUpdateRunMock).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      alreadyRunning: false,
      runId: "run-oppai",
    });
  });

  it("returns the real active run when enqueue loses a deduplication race", async () => {
    getSeriesMappingMock.mockReturnValue({
      seriesId: "local-series-1",
      sourceSeriesId: "source-series-1",
      source: "oppai",
    });
    const activeRun = {
      id: "run-race-winner",
      kind: "update",
      status: "running",
      scope: {
        entries: [{ sourceSeriesId: "source-series-1", source: "oppai" }],
      },
    };
    listRunsMock
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([activeRun])
      .mockReturnValueOnce([]);
    enqueueUpdateRunMock.mockReturnValue({
      id: "deduped-run",
      status: "succeeded",
      totalTasks: 0,
    });

    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/updates/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seriesId: "local-series-1", source: "oppai" }),
    }));

    await expect(response.json()).resolves.toMatchObject({
      alreadyRunning: true,
      runId: "run-race-winner",
      run: activeRun,
    });
  });

  it("returns 404 when the series has no source mapping", async () => {
    getSeriesMappingMock.mockReturnValue(null);

    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/updates/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seriesId: "missing-series" }),
    }));

    expect(response.status).toBe(404);
    expect(enqueueUpdateRunMock).not.toHaveBeenCalled();
  });
});
