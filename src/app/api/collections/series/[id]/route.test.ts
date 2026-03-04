import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listCollectionIdsForSeriesMock = vi.fn();
const replaceSeriesCollectionsMock = vi.fn();

vi.mock("@/lib/library/collections", () => ({
  listCollectionIdsForSeries: listCollectionIdsForSeriesMock,
  replaceSeriesCollections: replaceSeriesCollectionsMock,
}));

describe("series collections API", () => {
  beforeEach(() => {
    listCollectionIdsForSeriesMock.mockReset();
    replaceSeriesCollectionsMock.mockReset();
  });

  it("returns collection ids for a series", async () => {
    listCollectionIdsForSeriesMock.mockReturnValue(["col-1"]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "series-1" }),
    });

    await expect(response.json()).resolves.toEqual({ collectionIds: ["col-1"] });
  });

  it("validates collection assignment payloads", async () => {
    const { PUT } = await import("./route");
    const response = await PUT(
      new NextRequest("http://localhost/api/collections/series/series-1", {
        method: "PUT",
        body: JSON.stringify({ collectionIds: "col-1" }),
      }),
      { params: Promise.resolve({ id: "series-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "collectionIds are required" });
  });

  it("replaces collection membership", async () => {
    replaceSeriesCollectionsMock.mockResolvedValue(["col-1", "col-2"]);

    const { PUT } = await import("./route");
    const response = await PUT(
      new NextRequest("http://localhost/api/collections/series/series-1", {
        method: "PUT",
        body: JSON.stringify({
          collectionIds: ["col-1", "col-2"],
          series: {
            sourceId: "series-1",
            title: "Series One",
          },
        }),
      }),
      { params: Promise.resolve({ id: "series-1" }) },
    );

    expect(replaceSeriesCollectionsMock).toHaveBeenCalledWith(
      "series-1",
      ["col-1", "col-2"],
      expect.objectContaining({
        sourceId: "series-1",
        title: "Series One",
      }),
    );
    await expect(response.json()).resolves.toEqual({ collectionIds: ["col-1", "col-2"] });
  });
});
