import { beforeEach, describe, expect, it, vi } from "vitest";

const getChapterListMock = vi.fn();

vi.mock("@/lib/sources/weebcentral", () => ({
  getChapterList: getChapterListMock,
}));

describe("GET /api/series/[id]/chapters", () => {
  beforeEach(() => {
    getChapterListMock.mockReset();
  });

  it("returns the chapter list for a series", async () => {
    getChapterListMock.mockResolvedValue([{ sourceChapterId: "c1" }]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(getChapterListMock).toHaveBeenCalledWith("series-1");
    await expect(response.json()).resolves.toEqual([{ sourceChapterId: "c1" }]);
  });

  it("returns a 500 payload on scraper failure", async () => {
    getChapterListMock.mockRejectedValue(new Error("chapters failed"));

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "chapters failed" });
  });
});
