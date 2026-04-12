import { beforeEach, describe, expect, it, vi } from "vitest";

const getChapterListMock = vi.fn();
const getSeriesMappingMock = vi.fn();
const warmFlareSolverrHeadersMock = vi.fn();

vi.mock("@/lib/sources/init", () => ({}));
vi.mock("@/lib/media/flaresolverr", () => ({
  warmFlareSolverrHeaders: warmFlareSolverrHeadersMock,
}));
vi.mock("@/lib/sources/registry", () => ({
  getSource: () => ({ getChapterList: getChapterListMock }),
}));
vi.mock("@/lib/library/shared", () => ({
  getSeriesMapping: getSeriesMappingMock,
}));

describe("GET /api/series/[id]/chapters", () => {
  beforeEach(() => {
    getChapterListMock.mockReset();
    getSeriesMappingMock.mockReset();
    warmFlareSolverrHeadersMock.mockReset().mockResolvedValue(undefined);
    getSeriesMappingMock.mockReturnValue({
      seriesId: "local-series-3",
      sourceSeriesId: "test-unique-3",
      source: "madaradex",
    });
  });

  it("returns chapters with read state on refresh", async () => {
    getChapterListMock.mockResolvedValue([
      { sourceChapterId: "c1", chapterNo: 1, title: "Chapter 1" },
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/series/local-series-3/chapters?refresh=true"),
      { params: Promise.resolve({ id: "local-series-3" }) },
    );

    expect(getChapterListMock).toHaveBeenCalledWith("test-unique-3");
    expect(warmFlareSolverrHeadersMock).toHaveBeenCalledWith("madaradex");
    const body = await response.json();
    expect(body).toEqual([
      {
        sourceChapterId: "c1",
        chapterNo: 1,
        title: "Chapter 1",
        readState: "unread",
        lastPage: 0,
      },
    ]);
  });

  it("returns a 500 payload on scraper failure when no cache exists", async () => {
    getChapterListMock.mockRejectedValue(new Error("chapters failed"));
    getSeriesMappingMock.mockReturnValue({
      seriesId: "local-series-4",
      sourceSeriesId: "test-unique-4",
      source: "comix",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/series/local-series-4/chapters?refresh=true"),
      { params: Promise.resolve({ id: "local-series-4" }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error",
      code: "internal_error",
    });
  });

  it("supports direct source-backed chapter requests without a stored mapping", async () => {
    getSeriesMappingMock.mockReturnValue(null);
    getChapterListMock.mockResolvedValue([
      { sourceChapterId: "c2", chapterNo: 2, title: "Chapter 2" },
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/series/remote-series-2/chapters?source=madaradex"),
      { params: Promise.resolve({ id: "remote-series-2" }) },
    );

    expect(getChapterListMock).toHaveBeenCalledWith("remote-series-2");
    expect(warmFlareSolverrHeadersMock).toHaveBeenCalledWith("madaradex");
    await expect(response.json()).resolves.toEqual([
      {
        sourceChapterId: "c2",
        chapterNo: 2,
        title: "Chapter 2",
        readState: "unread",
        lastPage: 0,
      },
    ]);
  });
});
