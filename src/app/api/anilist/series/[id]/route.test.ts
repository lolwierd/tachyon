import { beforeEach, describe, expect, it, vi } from "vitest";

const getSeriesAniListSyncStatusMock = vi.fn();

vi.mock("@/lib/anilist/sync", () => ({
  getSeriesAniListSyncStatus: getSeriesAniListSyncStatusMock,
}));

describe("GET /api/anilist/series/[id]", () => {
  beforeEach(() => {
    getSeriesAniListSyncStatusMock.mockReset();
  });

  it("returns per-series sync visibility", async () => {
    getSeriesAniListSyncStatusMock.mockReturnValue({
      configured: true,
      connected: true,
      linked: true,
      syncState: "success",
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(getSeriesAniListSyncStatusMock).toHaveBeenCalledWith("series-1");
    await expect(response.json()).resolves.toEqual({
      configured: true,
      connected: true,
      linked: true,
      syncState: "success",
    });
  });
});
