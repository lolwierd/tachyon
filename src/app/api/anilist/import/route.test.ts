import { describe, expect, it, vi } from "vitest";

const importAniListLibraryMock = vi.fn();

vi.mock("@/lib/anilist/sync", () => ({
  importAniListLibrary: importAniListLibraryMock,
}));

describe("POST /api/anilist/import", () => {
  it("runs the import and returns the summary", async () => {
    importAniListLibraryMock.mockResolvedValue({
      imported: 3,
      skipped: 1,
      pushed: 0,
      pulled: 0,
      conflicts: 0,
    });

    const { POST } = await import("./route");
    const response = await POST();

    await expect(response.json()).resolves.toEqual({
      imported: 3,
      skipped: 1,
      pushed: 0,
      pulled: 0,
      conflicts: 0,
    });
  });
});
