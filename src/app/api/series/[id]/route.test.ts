import { beforeEach, describe, expect, it, vi } from "vitest";

const getSeriesDetailMock = vi.fn();

vi.mock("@/lib/sources/weebcentral", () => ({
  getSeriesDetail: getSeriesDetailMock,
}));

describe("GET /api/series/[id]", () => {
  beforeEach(() => {
    getSeriesDetailMock.mockReset();
  });

  it("returns the remote series detail", async () => {
    getSeriesDetailMock.mockResolvedValue({ title: "Series" });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(getSeriesDetailMock).toHaveBeenCalledWith("series-1");
    await expect(response.json()).resolves.toEqual({ title: "Series" });
  });

  it("returns a 500 payload on scraper failure", async () => {
    getSeriesDetailMock.mockRejectedValue(new Error("detail failed"));

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "detail failed" });
  });
});
