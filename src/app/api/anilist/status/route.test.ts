import { beforeEach, describe, expect, it, vi } from "vitest";

const disconnectAniListAccountMock = vi.fn();
const getAniListSyncOverviewMock = vi.fn();

vi.mock("@/lib/anilist/sync", () => ({
  disconnectAniListAccount: disconnectAniListAccountMock,
  getAniListSyncOverview: getAniListSyncOverviewMock,
}));

const SAME_ORIGIN_HEADERS = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
};

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
    const response = await DELETE(
      new Request("http://localhost/api/anilist/status", {
        method: "DELETE",
        headers: SAME_ORIGIN_HEADERS,
      }),
    );

    expect(disconnectAniListAccountMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
