import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache, getChapterList, getChapterPages, getSeriesDetail, search, fetchBuildId } from "./flamecomics";

const fetchMock = vi.fn();

function makeHomepageHtml(buildId: string) {
  return `<html><body>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      buildId,
      props: { pageProps: {} },
    })}</script>
  </body></html>`;
}

function makeNextDataResponse(pageProps: unknown) {
  return new Response(
    JSON.stringify({ pageProps }),
    { status: 200 },
  );
}

describe("flamecomics source adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    clearCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches buildId from homepage __NEXT_DATA__", async () => {
    fetchMock.mockResolvedValue(
      new Response(makeHomepageHtml("abc123buildid"), { status: 200 }),
    );

    const buildId = await fetchBuildId();
    expect(buildId).toBe("abc123buildid");
  });

  it("search fetches browse data and filters by query", async () => {
    // First call: homepage to get buildId
    fetchMock
      .mockResolvedValueOnce(
        new Response(makeHomepageHtml("build123"), { status: 200 }),
      )
      // Second call: browse.json
      .mockResolvedValueOnce(
        makeNextDataResponse({
          data: [
            {
              series_id: 42,
              title: "Solo Leveling",
              altTitles: "Na Honjaman Level Up",
              cover: "cover.jpg",
              status: "Ongoing",
              type: "Manhwa",
              author: "Chugong",
              artist: "Dubu",
              tags: ["Action", "Fantasy"],
              views: 10000,
            },
            {
              series_id: 99,
              title: "Other Series",
              cover: "other.jpg",
              status: "Complete",
              type: "Manga",
              tags: ["Romance"],
              views: 500,
            },
          ],
        }),
      );

    const results = await search("solo leveling");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/_next/data/build123/browse.json");
    expect(results).toEqual([
      {
        sourceId: "42",
        title: "Solo Leveling",
        slug: "42",
        coverUrl: "https://cdn.flamecomics.xyz/uploads/images/series/42/cover.jpg",
        year: null,
        status: "Ongoing",
        type: "Manhwa",
        authors: ["Chugong", "Dubu"],
        tags: ["Action", "Fantasy"],
        source: "flamecomics",
      },
    ]);
  });

  it("search returns all series when query is empty", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(makeHomepageHtml("build123"), { status: 200 }),
      )
      .mockResolvedValueOnce(
        makeNextDataResponse({
          data: [
            { series_id: 1, title: "Series A", cover: "a.jpg", tags: [] },
            { series_id: 2, title: "Series B", cover: "b.jpg", tags: [] },
          ],
        }),
      );

    const results = await search("");
    expect(results).toHaveLength(2);
  });

  it("parses series detail from Next.js data", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(makeHomepageHtml("build123"), { status: 200 }),
      )
      .mockResolvedValueOnce(
        makeNextDataResponse({
          data: {
            series_id: 42,
            title: "Solo Leveling",
            cover: "cover.jpg",
            description: "<p>A great <b>manhwa</b>.</p>",
            status: "Ongoing",
            type: "Manhwa",
            author: "Chugong",
            artist: "Dubu",
            tags: ["Action"],
          },
          chapters: [],
        }),
      );

    const detail = await getSeriesDetail("42");

    expect(detail).toEqual({
      sourceId: "42",
      title: "Solo Leveling",
      slug: "42",
      coverUrl: "https://cdn.flamecomics.xyz/uploads/images/series/42/cover.jpg",
      description: "A great manhwa.",
      authors: ["Chugong", "Dubu"],
      tags: ["Action"],
      type: "Manhwa",
      status: "Ongoing",
      year: null,
      isAdult: false,
      isOfficial: false,
      anilistUrl: null,
      relatedSeries: [],
    });
  });

  it("returns chapter list from Next.js data", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(makeHomepageHtml("build123"), { status: 200 }),
      )
      .mockResolvedValueOnce(
        makeNextDataResponse({
          chapters: [
            { chapter: 2, title: "The Second", token: "tok2", release_date: 1700000000 },
            { chapter: 1, title: null, token: "tok1", release_date: 1699000000 },
          ],
        }),
      );

    const chapters = await getChapterList("42");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/_next/data/build123/series/42.json");
    expect(chapters).toEqual([
      {
        sourceChapterId: "42/tok1",
        chapterNo: 1,
        title: "Chapter 1",
        publishedAt: 1699000000 * 1000,
      },
      {
        sourceChapterId: "42/tok2",
        chapterNo: 2,
        title: "Chapter 2 - The Second",
        publishedAt: 1700000000 * 1000,
      },
    ]);
  });

  it("extracts chapter page images from Next.js data", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(makeHomepageHtml("build123"), { status: 200 }),
      )
      .mockResolvedValueOnce(
        makeNextDataResponse({
          images: [
            { name: "page001.jpg" },
            { name: "page002.jpg" },
          ],
          release_date: 1700000000,
        }),
      );

    const pages = await getChapterPages("42/tok1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/_next/data/build123/series/42/tok1.json");
    expect(pages).toEqual([
      { index: 0, imageUrl: "https://cdn.flamecomics.xyz/uploads/images/series/42/page001.jpg?1700000000" },
      { index: 1, imageUrl: "https://cdn.flamecomics.xyz/uploads/images/series/42/page002.jpg?1700000000" },
    ]);
  });

  it("extracts chapter pages from dict-format images under chapter key", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(makeHomepageHtml("build123"), { status: 200 }),
      )
      .mockResolvedValueOnce(
        makeNextDataResponse({
          chapter: {
            series_id: 42,
            images: {
              "0": { name: "001-abc.jpg" },
              "1": { name: "002-def.jpg" },
              "2": { name: "003-ghi.jpg" },
            },
            release_date: 1611792000,
          },
        }),
      );

    const pages = await getChapterPages("42/tok1");

    expect(pages).toEqual([
      { index: 0, imageUrl: "https://cdn.flamecomics.xyz/uploads/images/series/42/001-abc.jpg?1611792000" },
      { index: 1, imageUrl: "https://cdn.flamecomics.xyz/uploads/images/series/42/002-def.jpg?1611792000" },
      { index: 2, imageUrl: "https://cdn.flamecomics.xyz/uploads/images/series/42/003-ghi.jpg?1611792000" },
    ]);
  });

  it("retries with new buildId on 404", async () => {
    // First: homepage for initial buildId
    fetchMock
      .mockResolvedValueOnce(
        new Response(makeHomepageHtml("old-build"), { status: 200 }),
      )
      // Second: 404 with old buildId
      .mockResolvedValueOnce(
        new Response("Not Found", { status: 404, statusText: "Not Found" }),
      )
      // Third: homepage for new buildId
      .mockResolvedValueOnce(
        new Response(makeHomepageHtml("new-build"), { status: 200 }),
      )
      // Fourth: success with new buildId
      .mockResolvedValueOnce(
        makeNextDataResponse({
          data: [{ series_id: 1, title: "Test", tags: [] }],
        }),
      );

    const results = await search("");

    expect(results).toHaveLength(1);
    expect(fetchMock.mock.calls[3]?.[0]).toContain("new-build");
  });

  it("surfaces upstream failures", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503, statusText: "Down" }));

    await expect(search("broken")).rejects.toThrow(
      "FlameComics request failed: 503 Down",
    );
  });

  it("handles missing series in detail response", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(makeHomepageHtml("build123"), { status: 200 }),
      )
      .mockResolvedValueOnce(
        makeNextDataResponse({ data: null }),
      );

    await expect(getSeriesDetail("999")).rejects.toThrow(
      "FlameComics: series not found: 999",
    );
  });

  it("search matches alternative titles", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(makeHomepageHtml("build123"), { status: 200 }),
      )
      .mockResolvedValueOnce(
        makeNextDataResponse({
          data: [
            {
              series_id: 10,
              title: "Omniscient Reader",
              altTitles: "Jeonjijeok Dokja Sijeom",
              cover: "orv.jpg",
              tags: [],
            },
          ],
        }),
      );

    const results = await search("Jeonjijeok");
    expect(results).toHaveLength(1);
    expect(results[0]?.title).toBe("Omniscient Reader");
  });
});
