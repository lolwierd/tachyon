import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sources/weebcentral", () => ({
  getSeriesDetail: vi.fn().mockResolvedValue({
    sourceId: "s1",
    title: "Test",
    slug: "test",
    coverUrl: "",
    description: "",
    authors: [],
    tags: [],
    type: "manga",
    status: "ongoing",
    year: 2020,
    isAdult: false,
    isOfficial: false,
    anilistUrl: null,
    relatedSeries: [],
  }),
  getChapterList: vi.fn().mockResolvedValue([]),
}));

describe("POST /api/series/[id]/mark-read", () => {
  it("returns 400 when chapterIds is missing", async () => {
    const { POST } = await import("./route");
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("chapterIds array is required");
  });

  it("returns 400 when chapterIds is empty", async () => {
    const { POST } = await import("./route");
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterIds: [] }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(response.status).toBe(400);
  });

  it("returns success for unknown chapters", async () => {
    const { POST } = await import("./route");
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterIds: ["nonexistent"], read: true }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ updated: 0, read: true });
  });
});
