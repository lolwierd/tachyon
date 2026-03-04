import { beforeEach, describe, expect, it, vi } from "vitest";

const getChapterPagesMock = vi.fn();

vi.mock("@/lib/sources/weebcentral", () => ({
  getChapterPages: getChapterPagesMock,
}));

describe("GET /api/chapters/[id]/pages", () => {
  beforeEach(() => {
    getChapterPagesMock.mockReset();
  });

  it("returns proxied chapter pages", async () => {
    getChapterPagesMock.mockResolvedValue([
      { index: 0, imageUrl: "https://hot.planeptune.us/page-1.jpg" },
    ]);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "chapter-1" }),
    });

    expect(getChapterPagesMock).toHaveBeenCalledWith("chapter-1");
    await expect(response.json()).resolves.toEqual([
      {
        index: 0,
        imageUrl:
          "/api/media/page?url=https%3A%2F%2Fhot.planeptune.us%2Fpage-1.jpg",
      },
    ]);
  });

  it("returns a 500 payload on scraper failure", async () => {
    getChapterPagesMock.mockRejectedValue(new Error("pages failed"));

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "chapter-1" }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "pages failed" });
  });
});
