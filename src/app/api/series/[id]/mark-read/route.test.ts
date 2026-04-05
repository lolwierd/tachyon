import { describe, expect, it, vi } from "vitest";

const getSeriesDetailMock = vi.fn().mockResolvedValue({
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
});

vi.mock("@/lib/sources/init", () => ({}));
vi.mock("@/lib/library/shared", () => ({
  getSeriesMapping: vi.fn(() => ({ seriesId: "local-series-1", source: "weebcentral" })),
}));
vi.mock("@/lib/sources/weebcentral", () => ({
  search: vi.fn().mockResolvedValue([]),
  getSeriesDetail: getSeriesDetailMock,
  getChapterList: vi.fn().mockResolvedValue([]),
  getChapterPages: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/sources/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sources/registry")>();
  return {
    ...actual,
    getSource: (name: string) => {
      if (name === "weebcentral") {
        return {
          name: "weebcentral",
          displayName: "WeebCentral",
          baseUrl: "https://weebcentral.com",
          isNsfw: false,
          search: vi.fn().mockResolvedValue([]),
          getSeriesDetail: getSeriesDetailMock,
          getChapterList: vi.fn().mockResolvedValue([]),
          getChapterPages: vi.fn().mockResolvedValue([]),
        };
      }
      return undefined;
    },
  };
});

const SAME_ORIGIN_HEADERS = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
};

function makeJsonRequest(body: unknown) {
  return new Request("http://localhost", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...SAME_ORIGIN_HEADERS,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/series/[id]/mark-read", () => {
  it("returns 400 when chapterIds is missing", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeJsonRequest({}), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });
  });

  it("returns 400 when chapterIds is empty", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeJsonRequest({ chapterIds: [] }), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(response.status).toBe(400);
  });

  it("returns success for unknown chapters", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeJsonRequest({ chapterIds: ["nonexistent"], read: true }), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ updated: 0, read: true });
  });
});
