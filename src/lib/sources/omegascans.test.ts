import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache, getChapterList, getChapterPages, getSeriesDetail, search } from "./omegascans";

const fetchMock = vi.fn();

describe("omegascans source adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    clearCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("search queries the HeanCms API and returns results", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 42,
              title: "Test Series",
              series_slug: "test-series",
              thumbnail: "https://cdn.example.com/cover.jpg",
              status: "Ongoing",
              series_type: "Comic",
              adult: true,
              created_at: "2024-03-15T00:00:00Z",
              authors: [{ name: "Author A" }],
              tags: [{ name: "Action" }, { name: "Fantasy" }],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const results = await search("test");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/query?");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("query_string=test");
    expect(results).toEqual([
      {
        sourceId: "test-series",
        title: "Test Series",
        slug: "test-series",
        coverUrl: "https://cdn.example.com/cover.jpg",
        year: 2024,
        status: "Ongoing",
        type: "Comic",
        authors: ["Author A"],
        tags: ["Action", "Fantasy"],
        source: "omegascans",
      },
    ]);
  });

  it("search stops paginating when data is empty", async () => {
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
          id: 42,
          title: "Test Series",
          series_slug: "test-series",
          thumbnail: "covers/test.jpg",
          description: "A test description",
          status: "Ongoing",
          series_type: "Comic",
          adult: true,
          created_at: "2024-03-15T00:00:00Z",
          authors: [{ name: "Author A" }],
          tags: [{ name: "Action" }],
          related_series: [
            {
              id: 99,
              title: "Related Series",
              series_slug: "related-series",
              pivot: { relation_type: "Sequel" },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const detail = await getSeriesDetail("test-series");

    expect(detail).toEqual({
      sourceId: "test-series",
      title: "Test Series",
      slug: "test-series",
      coverUrl: "https://api.omegascans.org/covers/test.jpg",
      description: "A test description",
      authors: ["Author A"],
      tags: ["Action"],
      type: "Comic",
      status: "Ongoing",
      year: 2024,
      isAdult: true,
      isOfficial: false,
      anilistUrl: null,
      relatedSeries: [
        {
          sourceId: "related-series",
          title: "Related Series",
          relationship: "Sequel",
        },
      ],
    });
  });

  it("returns chapters from seasons (V1)", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 42,
          title: "Test Series",
          series_slug: "test-series",
          seasons: [
            {
              index: 1,
              chapters: [
                {
                  id: 100,
                  chapter_name: "Chapter 2",
                  chapter_title: "The Second",
                  chapter_slug: "chapter-2",
                },
                {
                  id: 101,
                  chapter_name: "Chapter 1",
                  chapter_title: null,
                  chapter_slug: "chapter-1",
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const chapters = await getChapterList("test-series");

    expect(chapters).toEqual([
      {
        sourceChapterId: "test-series/chapter-2",
        chapterNo: 2,
        title: "Chapter 2 The Second",
      },
      {
        sourceChapterId: "test-series/chapter-1",
        chapterNo: 1,
        title: "Chapter 1",
      },
    ]);
  });

  it("falls back to V2 chapter query when no seasons", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 42,
            title: "Test Series",
            series_slug: "test-series",
            seasons: [],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                id: 200,
                chapter_name: "Chapter 5",
                chapter_title: "Hello",
                chapter_slug: "chapter-5",
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const chapters = await getChapterList("test-series");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/chapter/query?");
    expect(chapters).toEqual([
      {
        sourceChapterId: "test-series/chapter-5",
        chapterNo: 5,
        title: "Chapter 5 Hello",
      },
    ]);
  });

  it("extracts chapter page images", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          chapter: {
            id: 100,
            chapter_name: "Chapter 1",
            chapter_slug: "chapter-1",
            storage: "s3",
            chapter_data: {
              images: [
                "https://s3.example.com/page1.jpg",
                "https://s3.example.com/page2.jpg",
              ],
            },
          },
          data: [
            "https://s3.example.com/page1.jpg",
            "https://s3.example.com/page2.jpg",
          ],
        }),
        { status: 200 },
      ),
    );

    const pages = await getChapterPages("test-series/chapter-1");

    expect(pages).toEqual([
      { index: 0, imageUrl: "https://s3.example.com/page1.jpg" },
      { index: 1, imageUrl: "https://s3.example.com/page2.jpg" },
    ]);
  });

  it("throws on paywalled chapter", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          paywall: true,
          chapter: { id: 100, chapter_name: "Chapter 1", chapter_slug: "chapter-1" },
        }),
        { status: 200 },
      ),
    );

    await expect(getChapterPages("test-series/chapter-1")).rejects.toThrow(
      "Chapter is paywalled",
    );
  });

  it("surfaces upstream failures", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503, statusText: "Down" }));

    await expect(search("broken")).rejects.toThrow(
      "OmegaScans request failed: 503 Down",
    );
  });

  it("handles local storage images", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          chapter: {
            id: 100,
            chapter_name: "Chapter 1",
            chapter_slug: "chapter-1",
            storage: "local",
          },
          data: ["uploads/page1.jpg", "uploads/page2.jpg"],
        }),
        { status: 200 },
      ),
    );

    const pages = await getChapterPages("test-series/chapter-1");

    expect(pages).toEqual([
      { index: 0, imageUrl: "https://api.omegascans.org/uploads/page1.jpg" },
      { index: 1, imageUrl: "https://api.omegascans.org/uploads/page2.jpg" },
    ]);
  });
});
