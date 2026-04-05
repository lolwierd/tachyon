import { beforeEach, describe, expect, it, vi } from "vitest";

const getSeriesDetailMock = vi.fn();
const getSeriesMappingMock = vi.fn();
const warmFlareSolverrHeadersMock = vi.fn();

vi.mock("@/lib/sources/init", () => ({}));
vi.mock("@/lib/media/flaresolverr", () => ({
  warmFlareSolverrHeaders: warmFlareSolverrHeadersMock,
}));
vi.mock("@/lib/sources/registry", () => ({
  getSource: () => ({ getSeriesDetail: getSeriesDetailMock }),
}));
vi.mock("@/lib/library/shared", () => ({
  getSeriesMapping: getSeriesMappingMock,
}));

describe("GET /api/series/[id]", () => {
  beforeEach(() => {
    getSeriesDetailMock.mockReset();
    getSeriesMappingMock.mockReset();
    warmFlareSolverrHeadersMock.mockReset();
    getSeriesMappingMock.mockReturnValue({
      seriesId: "local-series-1",
      sourceSeriesId: "test-unique-1",
      source: "madaradex",
    });
  });

  it("returns the remote series detail on refresh", async () => {
    getSeriesDetailMock.mockResolvedValue({ title: "Series" });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/series/test-unique-1?refresh=true"),
      { params: Promise.resolve({ id: "local-series-1" }) },
    );

    expect(getSeriesDetailMock).toHaveBeenCalledWith("test-unique-1");
    expect(warmFlareSolverrHeadersMock).toHaveBeenCalledWith("madaradex");
    await expect(response.json()).resolves.toEqual({
      title: "Series",
      source: "madaradex",
      seriesId: "local-series-1",
    });
  });

  it("returns a 500 payload on scraper failure when no cache exists", async () => {
    getSeriesDetailMock.mockRejectedValue(new Error("detail failed"));
    getSeriesMappingMock.mockReturnValue({
      seriesId: "local-series-2",
      sourceSeriesId: "test-unique-2",
      source: "comix",
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/series/local-series-2?refresh=true"),
      { params: Promise.resolve({ id: "local-series-2" }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error",
      code: "internal_error",
    });
  });

  it("supports direct source-backed requests without a stored mapping", async () => {
    getSeriesMappingMock.mockReturnValue(null);
    getSeriesDetailMock.mockResolvedValue({ title: "Remote Only" });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/series/remote-series-1?source=madaradex"),
      { params: Promise.resolve({ id: "remote-series-1" }) },
    );

    expect(getSeriesDetailMock).toHaveBeenCalledWith("remote-series-1");
    expect(warmFlareSolverrHeadersMock).toHaveBeenCalledWith("madaradex");
    await expect(response.json()).resolves.toEqual({
      title: "Remote Only",
      source: "madaradex",
      seriesId: undefined,
    });
  });
});
