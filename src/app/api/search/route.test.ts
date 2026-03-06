import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const weebSearchMock = vi.fn();
const madaraSearchMock = vi.fn();

vi.mock("@/lib/sources/init", () => ({}));
vi.mock("@/lib/sources/registry", () => ({
  getAllSources: () => [
    { name: "weebcentral", search: weebSearchMock },
    { name: "madaradex", search: madaraSearchMock },
  ],
  getSfwSources: () => [{ name: "weebcentral", search: weebSearchMock }],
}));

describe("GET /api/search", () => {
  beforeEach(() => {
    weebSearchMock.mockReset();
    madaraSearchMock.mockReset();
  });

  it("passes query params through to the scraper", async () => {
    weebSearchMock.mockResolvedValue([{ sourceId: "1", title: "Test" }]);

    const { GET } = await import("./route");
    const request = new NextRequest(
      "http://localhost/api/search?q=vinland&author=Makoto&status=Ongoing&type=Manga&sort=Popularity",
    );

    const response = await GET(request);

    expect(weebSearchMock).toHaveBeenCalledWith("vinland", {
      author: "Makoto",
      sort: "Popularity",
      status: ["Ongoing"],
      type: ["Manga"],
    });
    await expect(response.json()).resolves.toEqual([{
      sourceId: "1",
      title: "Test",
      source: "weebcentral",
    }]);
  });

  it("returns empty results when the only source throws", async () => {
    weebSearchMock.mockRejectedValue(new Error("boom"));

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/search?q=oops"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });

  it("hides madaradex by default for nsfw search", async () => {
    weebSearchMock.mockResolvedValue([{ sourceId: "w-1", title: "Weeb" }]);
    madaraSearchMock.mockResolvedValue([{ sourceId: "m-1", title: "Madara" }]);

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/search?q=secret&nsfw=1"));

    expect(weebSearchMock).toHaveBeenCalledTimes(1);
    expect(madaraSearchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual([
      {
        sourceId: "w-1",
        title: "Weeb",
        source: "weebcentral",
      },
    ]);
  });

  it("includes madaradex when showMadaradex=1", async () => {
    weebSearchMock.mockResolvedValue([{ sourceId: "w-1", title: "Weeb" }]);
    madaraSearchMock.mockResolvedValue([{ sourceId: "m-1", title: "Madara" }]);

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/search?q=secret&nsfw=1&showMadaradex=1"));

    expect(weebSearchMock).toHaveBeenCalledTimes(1);
    expect(madaraSearchMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual([
      {
        sourceId: "w-1",
        title: "Weeb",
        source: "weebcentral",
      },
      {
        sourceId: "m-1",
        title: "Madara",
        source: "madaradex",
      },
    ]);
  });
});
