import { describe, expect, it, vi } from "vitest";

// Mock both the source AND the DB so the test never touches real data
const mockAll = vi.fn().mockReturnValue([]);

vi.mock("@/lib/sources/weebcentral", () => ({
  getSeriesDetail: vi.fn().mockResolvedValue({ title: "MockSeries" }),
  getChapterList: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            all: mockAll,
          }),
        }),
      }),
    }),
  }),
}));

describe("POST /api/library/refresh", () => {
  it("returns refresh results for empty library", async () => {
    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      total: 0,
      success: 0,
      failed: 0,
      results: [],
    });
  });
});
