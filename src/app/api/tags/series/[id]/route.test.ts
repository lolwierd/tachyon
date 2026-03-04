import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listTagIdsForSeriesMock = vi.fn();
const replaceSeriesTagsMock = vi.fn();

vi.mock("@/lib/library/tags", () => ({
  listTagIdsForSeries: listTagIdsForSeriesMock,
  replaceSeriesTags: replaceSeriesTagsMock,
}));

describe("series tags API", () => {
  beforeEach(() => {
    listTagIdsForSeriesMock.mockReset();
    replaceSeriesTagsMock.mockReset();
  });

  it("returns tag ids for a series", async () => {
    listTagIdsForSeriesMock.mockReturnValue(["tag-1"]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "series-1" }),
    });

    await expect(response.json()).resolves.toEqual({ tagIds: ["tag-1"] });
  });

  it("validates tag assignment payloads", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(
      new NextRequest("http://localhost/api/tags/series/series-1", {
        method: "PUT",
        body: JSON.stringify({ tagIds: "tag-1" }),
      }),
      { params: Promise.resolve({ id: "series-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "tagIds are required" });
  });

  it("replaces tag membership", async () => {
    replaceSeriesTagsMock.mockResolvedValue(["tag-1", "tag-2"]);

    const { PUT } = await import("./route");
    const response = await PUT(
      new NextRequest("http://localhost/api/tags/series/series-1", {
        method: "PUT",
        body: JSON.stringify({
          tagIds: ["tag-1", "tag-2"],
          series: {
            sourceId: "series-1",
            title: "Series One",
          },
        }),
      }),
      { params: Promise.resolve({ id: "series-1" }) },
    );

    expect(replaceSeriesTagsMock).toHaveBeenCalledWith(
      "series-1",
      ["tag-1", "tag-2"],
      expect.objectContaining({
        sourceId: "series-1",
        title: "Series One",
      }),
    );
    await expect(response.json()).resolves.toEqual({ tagIds: ["tag-1", "tag-2"] });
  });
});
