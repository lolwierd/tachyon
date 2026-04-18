import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache, getChapterList, getChapterPages, getSeriesDetail, search } from "./asurascans";

const fetchMock = vi.fn();

describe("asurascans source adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    clearCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("search queries the AsuraScans API and returns results", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              slug: "solo-leveling-ragnarok",
              title: "Solo Leveling: Ragnarok",
              cover: "https://cdn.asurascans.com/covers/solo.jpg",
              status: "Ongoing",
              type: "Manhwa",
              author: "Chugong",
              artist: "Dubu",
              genres: [{ name: "Action" }, { name: "Fantasy" }],
            },
          ],
          meta: { has_more: false },
        }),
        { status: 200 },
      ),
    );

    const results = await search("solo leveling");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/series?");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("search=solo+leveling");
    expect(results).toEqual([
      {
        sourceId: "solo-leveling-ragnarok",
        title: "Solo Leveling: Ragnarok",
        slug: "solo-leveling-ragnarok",
        coverUrl: "https://cdn.asurascans.com/covers/solo.jpg",
        year: null,
        status: "Ongoing",
        type: "Manhwa",
        authors: ["Chugong", "Dubu"],
        tags: ["Action", "Fantasy"],
        source: "asurascans",
      },
    ]);
  });

  it("search paginates when has_more is true", async () => {
    const page1Items = Array.from({ length: 20 }, (_, i) => ({
      slug: `series-${i}`,
      title: `Series ${i}`,
      cover: null,
      status: "Ongoing",
      genres: [],
    }));

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: page1Items, meta: { has_more: true } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ slug: "series-20", title: "Series 20", genres: [] }], meta: { has_more: false } }),
          { status: 200 },
        ),
      );

    const results = await search("series");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("offset=20");
    expect(results).toHaveLength(21);
  });

  it("search stops when data is empty", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );

    const results = await search("nothing");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(results).toEqual([]);
  });

  it("parses series detail from the API", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            series: {
              slug: "tower-of-god",
              title: "Tower of God",
              cover: "/covers/tog.jpg",
              description: "A boy enters a tower.",
              status: "Ongoing",
              type: "Manhwa",
              author: "SIU",
              artist: "SIU",
              genres: [{ name: "Action" }, { name: "Adventure" }],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const detail = await getSeriesDetail("tower-of-god");

    expect(detail).toEqual({
      sourceId: "tower-of-god",
      title: "Tower of God",
      slug: "tower-of-god",
      coverUrl: "https://asurascans.com/covers/tog.jpg",
      description: "A boy enters a tower.",
      authors: ["SIU"],
      tags: ["Action", "Adventure"],
      type: "Manhwa",
      status: "Ongoing",
      year: null,
      isAdult: false,
      isOfficial: false,
      anilistUrl: null,
      relatedSeries: [],
    });
  });

  it("deduplicates author and artist when same", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          slug: "test",
          title: "Test",
          author: "Same Person",
          artist: "Same Person",
          genres: [],
        }),
        { status: 200 },
      ),
    );

    const detail = await getSeriesDetail("test");
    expect(detail.authors).toEqual(["Same Person"]);
  });

  it("fetches chapters from the dedicated chapters API", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { number: 2, title: "The Awakening", is_locked: false, series_slug: "test-series" },
            { number: 1, title: null, is_locked: false, series_slug: "test-series" },
          ],
        }),
        { status: 200 },
      ),
    );

    const chapters = await getChapterList("test-series");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/series/test-series/chapters");
    expect(chapters).toEqual([
      {
        sourceChapterId: "test-series/chapter/1",
        chapterNo: 1,
        title: "Chapter 1",
      },
      {
        sourceChapterId: "test-series/chapter/2",
        chapterNo: 2,
        title: "Chapter 2 - The Awakening",
      },
    ]);
  });

  it("skips locked chapters", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { number: 2, title: "Free", is_locked: false, series_slug: "test" },
            { number: 3, title: "Premium", is_locked: true, series_slug: "test" },
          ],
        }),
        { status: 200 },
      ),
    );

    const chapters = await getChapterList("test");
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.chapterNo).toBe(2);
  });

  it("falls back to HTML scraping when chapters API fails", async () => {
    fetchMock
      // First call: chapters API fails
      .mockResolvedValueOnce(
        new Response("Not Found", { status: 404, statusText: "Not Found" }),
      )
      // Second call: HTML page with embedded chapter data
      .mockResolvedValueOnce(
        new Response(
          `<html><body>
            <script>${JSON.stringify({
              chapters: [
                { number: 5, title: null, is_locked: false, series_slug: "fallback-series" },
              ],
            })}</script>
          </body></html>`,
          { status: 200 },
        ),
      );

    const chapters = await getChapterList("fallback-series");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chapters).toEqual([
      {
        sourceChapterId: "fallback-series/chapter/5",
        chapterNo: 5,
        title: "Chapter 5",
      },
    ]);
  });

  it("extracts pages from Astro props", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `<html><body>
          <script>${JSON.stringify({
            pages: [
              { url: "https://cdn.asurascans.com/page1.jpg" },
              { url: "https://cdn.asurascans.com/page2.jpg" },
            ],
          })}</script>
        </body></html>`,
        { status: 200 },
      ),
    );

    const pages = await getChapterPages("test-series/chapter/1");

    expect(pages).toEqual([
      { index: 0, imageUrl: "https://cdn.asurascans.com/page1.jpg" },
      { index: 1, imageUrl: "https://cdn.asurascans.com/page2.jpg" },
    ]);
  });

  it("handles nested data.pages format", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `<html><body>
          <script>${JSON.stringify({
            data: {
              pages: [
                { url: "https://cdn.asurascans.com/p1.webp" },
              ],
            },
          })}</script>
        </body></html>`,
        { status: 200 },
      ),
    );

    const pages = await getChapterPages("test/chapter/1");
    expect(pages).toEqual([
      { index: 0, imageUrl: "https://cdn.asurascans.com/p1.webp" },
    ]);
  });

  it("surfaces upstream failures", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503, statusText: "Down" }));

    await expect(search("broken")).rejects.toThrow(
      "AsuraScans request failed: 503 Down",
    );
  });

  it("extracts all pages from Astro v5 serialized props (regression: only-first-page bug)", async () => {
    // AsuraScans' Astro v5 hydration format wraps every value in a [typeCode, data]
    // tuple: [0, primitive_or_object] for primitives/objects, [1, arr] for arrays.
    // Only the first 1-2 pages are server-rendered as <img> (loading="eager"); the
    // rest live inside astro-island[props] and must be deserialized.
    const astroProps = {
      seriesSlug: [0, "kidnapped-dragons"],
      chapterNumber: [0, 1],
      pages: [
        1,
        [
          [0, { url: [0, "https://cdn.asurascans.com/chapters/kd/1/001.webp"], width: [0, 800], height: [0, 1200] }],
          [0, { url: [0, "https://cdn.asurascans.com/chapters/kd/1/002.webp"], width: [0, 800], height: [0, 1200] }],
          [0, { url: [0, "https://cdn.asurascans.com/chapters/kd/1/003.webp"], width: [0, 800], height: [0, 1200] }],
          [0, { url: [0, "https://cdn.asurascans.com/chapters/kd/1/004.webp"], width: [0, 800], height: [0, 1200] }],
          [0, { url: [0, "https://cdn.asurascans.com/chapters/kd/1/005.webp"], width: [0, 800], height: [0, 1200] }],
        ],
      ],
    };
    const propsAttr = JSON.stringify(astroProps).replace(/"/g, "&quot;");

    fetchMock.mockResolvedValue(
      new Response(
        `<html><body>
          <astro-island uid="x" component-url="/ChapterReader.js" props="${propsAttr}">
            <img src="https://cdn.asurascans.com/chapters/kd/1/001.webp" alt="Page 1" loading="eager"/>
            <img src="https://cdn.asurascans.com/chapters/kd/1/002.webp" alt="Page 2" loading="eager"/>
          </astro-island>
        </body></html>`,
        { status: 200 },
      ),
    );

    const pages = await getChapterPages("kidnapped-dragons/chapter/1");

    expect(pages).toHaveLength(5);
    expect(pages).toEqual([
      { index: 0, imageUrl: "https://cdn.asurascans.com/chapters/kd/1/001.webp" },
      { index: 1, imageUrl: "https://cdn.asurascans.com/chapters/kd/1/002.webp" },
      { index: 2, imageUrl: "https://cdn.asurascans.com/chapters/kd/1/003.webp" },
      { index: 3, imageUrl: "https://cdn.asurascans.com/chapters/kd/1/004.webp" },
      { index: 4, imageUrl: "https://cdn.asurascans.com/chapters/kd/1/005.webp" },
    ]);
  });

  it("unwraps Astro v5 tuples when payload is inside a <script> tag", async () => {
    const astroProps = {
      pages: [
        1,
        [
          [0, { url: [0, "https://cdn.asurascans.com/x/1/001.webp"] }],
          [0, { url: [0, "https://cdn.asurascans.com/x/1/002.webp"] }],
          [0, { url: [0, "https://cdn.asurascans.com/x/1/003.webp"] }],
        ],
      ],
    };

    fetchMock.mockResolvedValue(
      new Response(
        `<html><body>
          <script>${JSON.stringify(astroProps)}</script>
        </body></html>`,
        { status: 200 },
      ),
    );

    const pages = await getChapterPages("x/chapter/1");
    expect(pages).toEqual([
      { index: 0, imageUrl: "https://cdn.asurascans.com/x/1/001.webp" },
      { index: 1, imageUrl: "https://cdn.asurascans.com/x/1/002.webp" },
      { index: 2, imageUrl: "https://cdn.asurascans.com/x/1/003.webp" },
    ]);
  });

  it("rejects prototype-pollution keys in Astro props", async () => {
    // Attacker-controlled props serialize __proto__ / constructor as own keys.
    // The unwrap must not let these land on Object.prototype.
    const propsAttr =
      '{&quot;__proto__&quot;:[0,{&quot;polluted&quot;:[0,true]}],&quot;pages&quot;:[1,[[0,{&quot;url&quot;:[0,&quot;https://cdn.asurascans.com/x/1/001.webp&quot;]}]]]}';

    fetchMock.mockResolvedValue(
      new Response(
        `<html><body>
          <astro-island uid="x" props="${propsAttr}"></astro-island>
        </body></html>`,
        { status: 200 },
      ),
    );

    const pages = await getChapterPages("x/chapter/1");
    expect(pages).toEqual([
      { index: 0, imageUrl: "https://cdn.asurascans.com/x/1/001.webp" },
    ]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("extracts pages from DOM img tags when Astro props are absent", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `<html><body>
          <div class="chapter-content">
            <img src="https://cdn.asurascans.com/asura-images/chapters/test-series/1/001.webp" alt="Page 1 - Chapter 1 - Test" class="w-full"/>
            <img src="https://cdn.asurascans.com/asura-images/chapters/test-series/1/002.webp" alt="Page 2 - Chapter 1 - Test" class="w-full"/>
            <img src="https://asurascans.com/logo.png" alt="Logo" />
          </div>
        </body></html>`,
        { status: 200 },
      ),
    );

    const pages = await getChapterPages("test-series/chapter/1");

    expect(pages).toEqual([
      { index: 0, imageUrl: "https://cdn.asurascans.com/asura-images/chapters/test-series/1/001.webp" },
      { index: 1, imageUrl: "https://cdn.asurascans.com/asura-images/chapters/test-series/1/002.webp" },
    ]);
  });

  it("builds relative cover URLs correctly", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              slug: "test",
              title: "Test",
              cover: "/covers/test.jpg",
              genres: [],
            },
          ],
          meta: { has_more: false },
        }),
        { status: 200 },
      ),
    );

    const results = await search("test");
    expect(results[0]?.coverUrl).toBe("https://asurascans.com/covers/test.jpg");
  });
});
