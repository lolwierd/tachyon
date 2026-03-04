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

  it("connects the account and redirects to the success state", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/api/anilist/callback?code=test-code"),
    );

    expect(connectAniListAccountMock).toHaveBeenCalledWith("test-code");
    expect(response.headers.get("location")).toBe("http://localhost/library?anilist=connected");
  });
});
