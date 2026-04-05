import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectAniListAccountMock = vi.fn();

vi.mock("@/lib/anilist/sync", () => ({
  connectAniListAccount: connectAniListAccountMock,
}));

describe("GET /api/anilist/callback", () => {
  beforeEach(() => {
    connectAniListAccountMock.mockReset();
  });

  it("redirects back to library when the code is missing", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/anilist/callback"));

    expect(response.headers.get("location")).toBe("http://localhost/library?anilist=missing-code");
  });

  it("rejects the callback when the oauth state does not match", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/api/anilist/callback?code=test-code&state=wrong-state", {
        headers: {
          cookie: "tachyon_anilist_oauth_state=test-state",
        },
      }),
    );

    expect(connectAniListAccountMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost/library?anilist=invalid-state");
  });

  it("connects the account and redirects to the success state", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/api/anilist/callback?code=test-code&state=test-state", {
        headers: {
          cookie: "tachyon_anilist_oauth_state=test-state",
        },
      }),
    );

    expect(connectAniListAccountMock).toHaveBeenCalledWith("test-code");
    expect(response.headers.get("location")).toBe("http://localhost/library?anilist=connected");
  });
});
