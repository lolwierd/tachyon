import { beforeEach, describe, expect, it, vi } from "vitest";

const getChapterPagesMock = vi.fn();
const getSourceMock = vi.fn();
const getMock = vi.fn();
const getSeriesMappingMock = vi.fn();
const resolveSourceForSeriesMock = vi.fn();
const warmFlareSolverrHeadersMock = vi.fn();
const getChapterPagesFromManifestMock = vi.fn();

vi.mock("@/lib/sources/init", () => ({}));
vi.mock("@/lib/media/flaresolverr", () => ({
  warmFlareSolverrHeaders: warmFlareSolverrHeadersMock,
}));
vi.mock("@/lib/library/shared", () => ({
  getSeriesMapping: getSeriesMappingMock,
  resolveSourceForSeries: resolveSourceForSeriesMock,
}));
vi.mock("@/lib/offline/state", () => ({
  getChapterPagesFromManifest: getChapterPagesFromManifestMock,
}));
vi.mock("@/lib/sources/registry", () => ({
  getSource: getSourceMock,
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            get: getMock,
          }),
        }),
      }),
    }),
  }),
}));

describe("GET /api/chapters/[id]/pages", () => {
  beforeEach(() => {
    getChapterPagesMock.mockReset();
    getSourceMock.mockReset();
    getMock.mockReset();
    getSeriesMappingMock.mockReset();
    resolveSourceForSeriesMock.mockReset();
    warmFlareSolverrHeadersMock.mockReset().mockResolvedValue(undefined);
    getChapterPagesFromManifestMock.mockReset();
    getSourceMock.mockReturnValue({
      baseUrl: "https://weebcentral.com",
      getChapterPages: getChapterPagesMock,
    });
    getMock.mockReturnValue({ source: "weebcentral" });
    getSeriesMappingMock.mockReturnValue(null);
    resolveSourceForSeriesMock.mockReturnValue("weebcentral");
    getChapterPagesFromManifestMock.mockResolvedValue(null);
  });

  it("returns proxied chapter pages", async () => {
    getChapterPagesMock.mockResolvedValue([
      { index: 0, imageUrl: "https://hot.planeptune.us/page-1.jpg" },
    ]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/chapters/chapter-1/pages?seriesId=series-1"), {
      params: Promise.resolve({ id: "chapter-1" }),
    });

    expect(getChapterPagesMock).toHaveBeenCalledWith("chapter-1");
    expect(response.headers.get("Cache-Control")).toBe(
      "private, max-age=300",
    );
    await expect(response.json()).resolves.toEqual([
      {
        index: 0,
        imageUrl:
          "/api/media/page?url=https%3A%2F%2Fhot.planeptune.us%2Fpage-1.jpg&source=weebcentral&referer=https%3A%2F%2Fweebcentral.com%2F",
      },
    ]);
    expect(warmFlareSolverrHeadersMock).toHaveBeenCalledWith("weebcentral", "https://weebcentral.com/");
  });

  it("returns a 500 payload on scraper failure", async () => {
    getChapterPagesMock.mockRejectedValue(new Error("pages failed"));

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/chapters/chapter-1/pages?seriesId=series-1"), {
      params: Promise.resolve({ id: "chapter-1" }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error",
      code: "internal_error",
    });
  });

  it("falls back to the series mapping when the chapter is not cached", async () => {
    getMock.mockReturnValue(undefined);
    getChapterPagesMock.mockResolvedValue([
      { index: 0, imageUrl: "https://hot.planeptune.us/page-1.jpg" },
    ]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/chapters/chapter-1/pages?seriesId=series-1"), {
      params: Promise.resolve({ id: "chapter-1" }),
    });

    expect(getSeriesMappingMock).toHaveBeenCalledWith("series-1");
    expect(resolveSourceForSeriesMock).toHaveBeenCalledWith("series-1", null);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        index: 0,
        imageUrl:
          "/api/media/page?url=https%3A%2F%2Fhot.planeptune.us%2Fpage-1.jpg&source=weebcentral&referer=https%3A%2F%2Fweebcentral.com%2F",
      },
    ]);
  });

  it("uses the explicit source query when provided", async () => {
    getMock.mockReturnValue(undefined);
    getSeriesMappingMock.mockReturnValue({ source: "toonily" });
    resolveSourceForSeriesMock.mockReturnValue("toonily");
    getChapterPagesMock.mockResolvedValue([
      { index: 0, imageUrl: "https://hot.planeptune.us/page-1.jpg" },
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/chapters/chapter-1/pages?seriesId=series-1&source=oppai"),
      {
        params: Promise.resolve({ id: "chapter-1" }),
      },
    );

    expect(getChapterPagesFromManifestMock).toHaveBeenCalledWith("series-1", "chapter-1", "oppai");
    expect(getMock).not.toHaveBeenCalled();
    expect(getSeriesMappingMock).not.toHaveBeenCalled();
    expect(resolveSourceForSeriesMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual([
      {
        index: 0,
        imageUrl:
          "/api/media/page?url=https%3A%2F%2Fhot.planeptune.us%2Fpage-1.jpg&source=oppai&referer=https%3A%2F%2Fweebcentral.com%2F",
      },
    ]);
  });

  it("passes the requested source into manifest lookup", async () => {
    getChapterPagesFromManifestMock.mockResolvedValue([
      { index: 0, imageUrl: "https://cdn.example/page-1.jpg" },
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/chapters/chapter-1/pages?seriesId=series-1&source=oppai"),
      {
        params: Promise.resolve({ id: "chapter-1" }),
      },
    );

    expect(getChapterPagesFromManifestMock).toHaveBeenCalledWith("series-1", "chapter-1", "oppai");
    expect(getChapterPagesMock).not.toHaveBeenCalled();
    expect(warmFlareSolverrHeadersMock).toHaveBeenCalledWith("oppai", "https://weebcentral.com/");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        index: 0,
        imageUrl:
          "/api/media/page?url=https%3A%2F%2Fcdn.example%2Fpage-1.jpg&source=oppai&referer=https%3A%2F%2Fweebcentral.com%2F",
      },
    ]);
  });

  it("resolves the chapter source before manifest lookup when source is omitted", async () => {
    getMock.mockReturnValue({ source: "toonily" });
    getChapterPagesFromManifestMock.mockResolvedValue([
      { index: 1, imageUrl: "https://cdn.example/page-2.jpg" },
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/chapters/chapter-1/pages?seriesId=series-1"),
      {
        params: Promise.resolve({ id: "chapter-1" }),
      },
    );

    expect(getChapterPagesFromManifestMock).toHaveBeenCalledWith("series-1", "chapter-1", "toonily");
    expect(getChapterPagesMock).not.toHaveBeenCalled();
    expect(warmFlareSolverrHeadersMock).toHaveBeenCalledWith("toonily", "https://weebcentral.com/");
    await expect(response.json()).resolves.toEqual([
      {
        index: 1,
        imageUrl:
          "/api/media/page?url=https%3A%2F%2Fcdn.example%2Fpage-2.jpg&source=toonily&referer=https%3A%2F%2Fweebcentral.com%2F",
      },
    ]);
  });

  it("uses Mgeko's reader URL as the CDN referer", async () => {
    const sourceChapterId = "solo-leveling-mg1/solo-leveling-chapter-200-5-eng-li";
    getSourceMock.mockReturnValue({
      baseUrl: "https://www.mgeko.cc",
      getChapterUrl: () => "https://www.mgeko.cc/reader/en/solo-leveling-chapter-200-5-eng-li/",
      getChapterPages: getChapterPagesMock,
    });
    getChapterPagesMock.mockResolvedValue([
      {
        index: 0,
        imageUrl: "https://imgsrv5.com/mg1/fastcdn/cdn_mangaraw/solo-leveling-mg1/chapter-200.5/1.jpg",
      },
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request(`http://localhost/api/chapters/${encodeURIComponent(sourceChapterId)}/pages?seriesId=series-1&source=mgeko`),
      { params: Promise.resolve({ id: sourceChapterId }) },
    );

    expect(getSourceMock).toHaveBeenCalledWith("mgeko");
    expect(getChapterPagesMock).toHaveBeenCalledWith(sourceChapterId);
    await expect(response.json()).resolves.toEqual([
      {
        index: 0,
        imageUrl:
          "/api/media/page?url=https%3A%2F%2Fimgsrv5.com%2Fmg1%2Ffastcdn%2Fcdn_mangaraw%2Fsolo-leveling-mg1%2Fchapter-200.5%2F1.jpg&source=mgeko&referer=https%3A%2F%2Fwww.mgeko.cc%2Freader%2Fen%2Fsolo-leveling-chapter-200-5-eng-li%2F",
      },
    ]);
    expect(warmFlareSolverrHeadersMock).toHaveBeenCalledWith(
      "mgeko",
      "https://www.mgeko.cc/reader/en/solo-leveling-chapter-200-5-eng-li/",
    );
  });
});
