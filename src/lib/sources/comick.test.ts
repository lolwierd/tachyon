import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache, getChapterList, getChapterPages, getSeriesDetail, search } from "./comick";

const fetchMock = vi.fn();

describe("comick source adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    clearCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("search queries the ComicK API and returns results", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            slug: "solo-leveling",
            title: "Solo Leveling",
            default_thumbnail: "solo-leveling-cover.jpg",
            status: 2,
            country: "kr",
            md_comic_md_genres: [
              { md_genres: { name: "Action", slug: "action" } },
              { md_genres: { name: "Fantasy", slug: "fantasy" } },
            ],
          },
        ]),
        { status: 200 },
      ),
    );

    const results = await search("solo leveling");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/search?");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("q=solo+leveling");
    expect(results).toEqual([
      {
        sourceId: "solo-leveling",
        title: "Solo Leveling",
        slug: "solo-leveling",
        coverUrl: "https://meo.comick.pictures/solo-leveling-cover.jpg",
        year: null,
        status: "Complete",
        type: "Manhwa",
        authors: [],
        tags: ["Action", "Fantasy"],
        source: "comick",
      },
    ]);
  });

  it("search returns empty for short queries", async () => {
    const results = await search("ab");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it("search handles empty response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    const results = await search("nothing");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(results).toEqual([]);
  });

  it("parses series detail from embedded HTML data", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `<html><body>
          <h1>Solo Leveling</h1>
          <div id="comic-data">${JSON.stringify({
            title: "Solo Leveling",
            slug: "solo-leveling",
            default_thumbnail: "solo-leveling-cover.jpg",
            status: 2,
            country: "kr",
            desc: "A great manhwa about leveling up.",
            authors: [{ name: "Chugong" }],
            artists: [{ name: "Dubu" }],
            content_rating: "safe",
            md_comic_md_genres: [
              { md_genres: { name: "Action", slug: "action" } },
            ],
          })}</div>
        </body></html>`,
        { status: 200 },
      ),
    );

    const detail = await getSeriesDetail("solo-leveling");

    expect(detail).toEqual({
      sourceId: "solo-leveling",
      title: "Solo Leveling",
      slug: "solo-leveling",
      coverUrl: "https://meo.comick.pictures/solo-leveling-cover.jpg",
      description: "A great manhwa about leveling up.",
      authors: ["Chugong", "Dubu"],
      tags: ["Action"],
      type: "Manhwa",
      status: "Complete",
      year: null,
      isAdult: false,
      isOfficial: false,
      anilistUrl: null,
      relatedSeries: [],
    });
  });

  it("returns chapters from API with pagination", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              hid: "abc123",
              chap: "2",
              vol: "1",
              lang: "en",
              title: "The Awakening",
              created_at: "2024-01-15T00:00:00.000000Z",
            },
            {
              hid: "def456",
              chap: "1",
              lang: "en",
              title: null,
              created_at: "2024-01-10T00:00:00.000000Z",
            },
          ],
          pagination: {
            current_page: 1,
            last_page: 1,
          },
        }),
        { status: 200 },
      ),
    );

    const chapters = await getChapterList("solo-leveling");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/comics/solo-leveling/chapter-list");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("lang=en");
    expect(chapters).toEqual([
      {
        sourceChapterId: "abc123",
        chapterNo: 2,
        title: "Vol.1 Chapter 2 - The Awakening",
      },
      {
        sourceChapterId: "def456",
        chapterNo: 1,
        title: "Chapter 1",
      },
    ]);
  });

  it("deduplicates chapters by hid", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { hid: "abc123", chap: "1", lang: "en" },
            { hid: "abc123", chap: "1", lang: "en" },
          ],
          pagination: { current_page: 1, last_page: 1 },
        }),
        { status: 200 },
      ),
    );

    const chapters = await getChapterList("test-series");
    expect(chapters).toHaveLength(1);
  });

  it("extracts chapter pages from embedded sv-data", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `<html><body>
          <div id="sv-data">${JSON.stringify({
            chapter: {
              images: [
                { url: "https://meo.comick.pictures/page1.jpg" },
                { url: "https://meo.comick.pictures/page2.jpg" },
              ],
            },
          })}</div>
        </body></html>`,
        { status: 200 },
      ),
    );

    const pages = await getChapterPages("abc123");

    expect(pages).toEqual([
      { index: 0, imageUrl: "https://meo.comick.pictures/page1.jpg" },
      { index: 1, imageUrl: "https://meo.comick.pictures/page2.jpg" },
    ]);
  });

  it("falls back to script tag extraction for pages", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `<html><body>
          <script>${JSON.stringify({
            chapter: {
              images: [
                { url: "https://meo.comick.pictures/p1.webp" },
                { url: "https://meo.comick.pictures/p2.webp" },
              ],
            },
          })}</script>
        </body></html>`,
        { status: 200 },
      ),
    );

    const pages = await getChapterPages("xyz789");

    expect(pages).toEqual([
      { index: 0, imageUrl: "https://meo.comick.pictures/p1.webp" },
      { index: 1, imageUrl: "https://meo.comick.pictures/p2.webp" },
    ]);
  });

  it("handles absolute thumbnail URLs", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            slug: "test",
            title: "Test",
            default_thumbnail: "https://cdn.example.com/cover.jpg",
            country: "jp",
          },
        ]),
        { status: 200 },
      ),
    );

    const results = await search("test");
    expect(results[0]?.coverUrl).toBe("https://cdn.example.com/cover.jpg");
  });

  it("surfaces upstream failures", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503, statusText: "Down" }));

    await expect(search("broken")).rejects.toThrow(
      "ComicK request failed: 503 Down",
    );
  });
});
