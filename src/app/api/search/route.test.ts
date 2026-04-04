import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const weebSearchMock = vi.fn();
const manhwa18SearchMock = vi.fn();
const omegaSearchMock = vi.fn();
const madaraSearchMock = vi.fn();

vi.mock("@/lib/sources/init", () => ({}));
vi.mock("@/lib/sources/registry", () => ({
  getMainSources: (nsfw: boolean) => {
    const main = [{ name: "weebcentral", search: weebSearchMock }];
    if (nsfw) {
      main.push(
        { name: "manhwa18", search: manhwa18SearchMock },
        { name: "omegascans", search: omegaSearchMock },
      );
    }
    return main;
  },
  getExtraSources: (nsfw: boolean) => {
    if (nsfw) return [{ name: "madaradex", search: madaraSearchMock }];
    return [];
  },
}));

describe("GET /api/search", () => {
  beforeEach(() => {
    weebSearchMock.mockReset();
    manhwa18SearchMock.mockReset();
    omegaSearchMock.mockReset();
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
    await expect(response.json()).resolves.toEqual({
      results: [{ sourceId: "1", title: "Test", source: "weebcentral" }],
      errors: [],
    });
  });

  it("returns empty results when the only source throws", async () => {
    weebSearchMock.mockRejectedValue(new Error("boom"));

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/search?q=oops"));

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.results).toEqual([]);
    expect(json.errors).toHaveLength(1);
  });

  it("uses only main sources by default", async () => {
    weebSearchMock.mockResolvedValue([{ sourceId: "w-1", title: "Weeb" }]);

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/search?q=test"));

    expect(weebSearchMock).toHaveBeenCalledTimes(1);
    expect(madaraSearchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      results: [{ sourceId: "w-1", title: "Weeb", source: "weebcentral" }],
      errors: [],
    });
  });

  it("includes nsfw main sources when nsfw=1", async () => {
    weebSearchMock.mockResolvedValue([{ sourceId: "w-1", title: "Weeb" }]);
    manhwa18SearchMock.mockResolvedValue([{ sourceId: "m-1", title: "M18" }]);
    omegaSearchMock.mockResolvedValue([{ sourceId: "o-1", title: "Omega" }]);

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/search?q=test&nsfw=1"));

    expect(weebSearchMock).toHaveBeenCalledTimes(1);
    expect(manhwa18SearchMock).toHaveBeenCalledTimes(1);
    expect(omegaSearchMock).toHaveBeenCalledTimes(1);
    expect(madaraSearchMock).not.toHaveBeenCalled();
    const json = await response.json();
    expect(json.results).toHaveLength(3);
    expect(json.errors).toEqual([]);
  });

  it("includes extra sources when showExtra=1", async () => {
    weebSearchMock.mockResolvedValue([{ sourceId: "w-1", title: "Weeb" }]);
    manhwa18SearchMock.mockResolvedValue([{ sourceId: "m-1", title: "M18" }]);
    omegaSearchMock.mockResolvedValue([{ sourceId: "o-1", title: "Omega" }]);
    madaraSearchMock.mockResolvedValue([{ sourceId: "d-1", title: "Madara" }]);

    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/search?q=test&nsfw=1&showExtra=1"));

    expect(weebSearchMock).toHaveBeenCalledTimes(1);
    expect(manhwa18SearchMock).toHaveBeenCalledTimes(1);
    expect(omegaSearchMock).toHaveBeenCalledTimes(1);
    expect(madaraSearchMock).toHaveBeenCalledTimes(1);
    const json = await response.json();
    expect(json.results).toHaveLength(4);
    expect(json.errors).toEqual([]);
  });
});
