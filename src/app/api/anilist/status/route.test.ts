import { beforeEach, describe, expect, it, vi } from "vitest";

const disconnectAniListAccountMock = vi.fn();
const getAniListSyncOverviewMock = vi.fn();

vi.mock("@/lib/anilist/sync", () => ({
  disconnectAniListAccount: disconnectAniListAccountMock,
  getAniListSyncOverview: getAniListSyncOverviewMock,
}));

describe("GET /api/anilist/status", () => {
  beforeEach(() => {
    disconnectAniListAccountMock.mockReset();
    getAniListSyncOverviewMock.mockReset();
  });

  it("returns the current AniList sync overview", async () => {
    getAniListSyncOverviewMock.mockReturnValue({ configured: true, connected: false });

    const { GET } = await import("./route");
    const response = await GET();

    await expect(response.json()).resolves.toEqual({ configured: true, connected: false });
  });

  it("disconnects the account on DELETE", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE();

    expect(disconnectAniListAccountMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
