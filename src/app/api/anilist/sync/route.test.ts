import { describe, expect, it, vi } from "vitest";

const syncAniListLibraryMock = vi.fn();

vi.mock("@/lib/anilist/sync", () => ({
  syncAniListLibrary: syncAniListLibraryMock,
}));

const SAME_ORIGIN_HEADERS = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
};

describe("POST /api/anilist/sync", () => {
  it("runs a sync and returns the summary", async () => {
    syncAniListLibraryMock.mockResolvedValue({
      imported: 0,
      skipped: 0,
      pushed: 2,
      pulled: 1,
      conflicts: 1,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/anilist/sync", {
        method: "POST",
        headers: SAME_ORIGIN_HEADERS,
      }),
    );

    await expect(response.json()).resolves.toEqual({
      imported: 0,
      skipped: 0,
      pushed: 2,
      pulled: 1,
      conflicts: 1,
    });
  });
});
