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

describe("fixChapterNo extracts chapter numbers from titles", () => {
  beforeEach(() => {
    getChapterListMock.mockReset();
    getSeriesMappingMock.mockReset();
    warmFlareSolverrHeadersMock.mockReset().mockResolvedValue(undefined);
  });

  it("fixes chapterNo=0 chapters with keyword-based titles", async () => {
    getSeriesMappingMock.mockReturnValue({
      seriesId: "local-series-fix",
      sourceSeriesId: "test-fix",
      source: "madaradex",
    });
    getChapterListMock.mockResolvedValue([
      { sourceChapterId: "c1", chapterNo: 0, title: "Chapter 96" },
      { sourceChapterId: "c2", chapterNo: 0, title: "Episode 10" },
      { sourceChapterId: "c3", chapterNo: 0, title: "Ch. 5" },
      { sourceChapterId: "c4", chapterNo: 0, title: "Ch 96.5" },
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/series/local-series-fix/chapters?refresh=true&source=madaradex"),
      { params: Promise.resolve({ id: "local-series-fix" }) },
    );

    const body = await response.json();
    expect(body.map((c: { chapterNo: number }) => c.chapterNo)).toEqual([5, 10, 96, 96.5]);
  });

  it("extracts numbers from titles without keyword prefixes", async () => {
    getSeriesMappingMock.mockReturnValue({
      seriesId: "local-series-opm",
      sourceSeriesId: "test-opm",
      source: "madaradex",
    });
    getChapterListMock.mockResolvedValue([
      { sourceChapterId: "c1", chapterNo: 0, title: "Official Scans 161" },
      { sourceChapterId: "c2", chapterNo: 0, title: "Mag Version 222" },
      { sourceChapterId: "c3", chapterNo: 0, title: "ReDraw 224.5" },
      { sourceChapterId: "c4", chapterNo: 0, title: "Punch 1" },
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/series/local-series-opm/chapters?refresh=true&source=madaradex"),
      { params: Promise.resolve({ id: "local-series-opm" }) },
    );

    const body = await response.json();
    expect(body.map((c: { chapterNo: number }) => c.chapterNo)).toEqual([1, 161, 222, 224.5]);
  });

  it("preserves non-zero chapterNo values", async () => {
    getSeriesMappingMock.mockReturnValue({
      seriesId: "local-series-keep",
      sourceSeriesId: "test-keep",
      source: "madaradex",
    });
    getChapterListMock.mockResolvedValue([
      { sourceChapterId: "c1", chapterNo: 42, title: "Some Title 999" },
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/series/local-series-keep/chapters?refresh=true&source=madaradex"),
      { params: Promise.resolve({ id: "local-series-keep" }) },
    );

    const body = await response.json();
    expect(body[0].chapterNo).toBe(42);
  });
});

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
