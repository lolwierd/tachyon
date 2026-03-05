import { beforeEach, describe, expect, it, vi } from "vitest";

const listRunsMock = vi.fn();
const listTasksForRunsMock = vi.fn();

vi.mock("@/lib/background/queue", () => ({
  listRuns: listRunsMock,
  listTasksForRuns: listTasksForRunsMock,
}));

describe("updates runs API", () => {
  beforeEach(() => {
    listRunsMock.mockReset();
    listTasksForRunsMock.mockReset();
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
});
