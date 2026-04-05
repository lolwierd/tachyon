import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listTagIdsForSeriesMock = vi.fn();
const replaceSeriesTagsMock = vi.fn();

vi.mock("@/lib/library/tags", () => ({
  listTagIdsForSeries: listTagIdsForSeriesMock,
  replaceSeriesTags: replaceSeriesTagsMock,
}));

const SAME_ORIGIN_HEADERS = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
};

function makePutRequest(body: unknown) {
  return new NextRequest("http://localhost/api/tags/series/series-1", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...SAME_ORIGIN_HEADERS,
    },
    body: JSON.stringify(body),
  });
}

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
    const response = await PUT(makePutRequest({ tagIds: "tag-1" }), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });
  });

  it("replaces tag membership", async () => {
    replaceSeriesTagsMock.mockResolvedValue(["tag-1", "tag-2"]);

    const { PUT } = await import("./route");
    const response = await PUT(makePutRequest({
      tagIds: ["tag-1", "tag-2"],
    }), { params: Promise.resolve({ id: "series-1" }) });

    expect(replaceSeriesTagsMock).toHaveBeenCalledWith(
      "series-1",
      ["tag-1", "tag-2"],
      undefined,
    );
    await expect(response.json()).resolves.toEqual({ tagIds: ["tag-1", "tag-2"] });
  });
});
