import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const searchMock = vi.fn();

vi.mock("@/lib/sources/weebcentral", () => ({
  search: searchMock,
}));

describe("GET /api/search", () => {
  beforeEach(() => {
    searchMock.mockReset();
  });

  it("passes query params through to the scraper", async () => {
    searchMock.mockResolvedValue([{ sourceId: "1", title: "Test" }]);

    const { GET } = await import("./route");
    const request = new NextRequest(
      "http://localhost/api/search?q=vinland&author=Makoto&status=Ongoing&type=Manga&sort=Popularity",
    );

    const response = await GET(request);

    expect(searchMock).toHaveBeenCalledWith("vinland", {
      author: "Makoto",
      sort: "Popularity",
      status: ["Ongoing"],
      type: ["Manga"],
    });
    await expect(response.json()).resolves.toEqual([{ sourceId: "1", title: "Test" }]);
  });

  it("returns a 500 payload when the scraper throws", async () => {
    searchMock.mockRejectedValue(new Error("boom"));

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/search?q=oops"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "boom" });
  });
});
