import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const getAniListConnectUrlMock = vi.fn();

vi.mock("@/lib/anilist/sync", () => ({
  getAniListConnectUrl: getAniListConnectUrlMock,
}));

describe("GET /api/anilist/connect", () => {
  it("redirects to the AniList authorize URL", async () => {
    getAniListConnectUrlMock.mockReturnValue("https://anilist.co/api/v2/oauth/authorize?client_id=1");

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/anilist/connect"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://anilist.co/api/v2/oauth/authorize?client_id=1",
    );
    expect(getAniListConnectUrlMock).toHaveBeenCalledWith(expect.any(String));
    expect(response.cookies.get("tachyon_anilist_oauth_state")?.value).toEqual(expect.any(String));
  });
});
