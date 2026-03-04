import { describe, expect, it, vi } from "vitest";

const getAniListConnectUrlMock = vi.fn();

vi.mock("@/lib/anilist/sync", () => ({
  getAniListConnectUrl: getAniListConnectUrlMock,
}));

describe("GET /api/anilist/connect", () => {
  it("redirects to the AniList authorize URL", async () => {
    getAniListConnectUrlMock.mockReturnValue("https://anilist.co/api/v2/oauth/authorize?client_id=1");

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://anilist.co/api/v2/oauth/authorize?client_id=1",
    );
  });
});
