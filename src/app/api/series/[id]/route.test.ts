import { beforeEach, describe, expect, it, vi } from "vitest";

const getSeriesDetailMock = vi.fn();

vi.mock("@/lib/sources/weebcentral", () => ({
  getSeriesDetail: getSeriesDetailMock,
}));

describe("GET /api/series/[id]", () => {
  beforeEach(() => {
    getSeriesDetailMock.mockReset();
  });

  it("returns the remote series detail on refresh", async () => {
    getSeriesDetailMock.mockResolvedValue({ title: "Series" });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/series/test-unique-1?refresh=true"),
      { params: Promise.resolve({ id: "test-unique-1" }) },
    );

    expect(getSeriesDetailMock).toHaveBeenCalledWith("test-unique-1");
    await expect(response.json()).resolves.toEqual({ title: "Series" });
  });

  it("returns a 500 payload on scraper failure when no cache exists", async () => {
    getSeriesDetailMock.mockRejectedValue(new Error("detail failed"));

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/series/test-unique-2?refresh=true"),
      { params: Promise.resolve({ id: "test-unique-2" }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "detail failed" });
  });
});
