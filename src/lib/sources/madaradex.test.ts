import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChapterList, getChapterPages, getSeriesDetail, search } from "./madaradex";

const fetchMock = vi.fn();

describe("madaradex source adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("search parses Madara search results HTML", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `
          <div class="c-tabs-item__content">
            <a href="https://madaradex.org/title/test-manga/">
              <img data-src="https://cdn.example.com/cover.jpg" />
            </a>
            <div class="post-title"><a href="https://madaradex.org/title/test-manga/">Test Manga</a></div>
            <div class="mg_author"><a href="/manga-author/author-a/">Author A</a></div>
            <div class="mg_genres"><a href="/manga-genre/action/">Action</a></div>
            <div class="mg_status">Ongoing</div>
          </div>
          <div class="c-tabs-item__content">
            <a href="https://madaradex.org/title/test-manga/">
              <img data-src="https://cdn.example.com/cover2.jpg" />
            </a>
            <div class="post-title"><a href="https://madaradex.org/title/test-manga/">Duplicate</a></div>
          </div>
        `,
        { status: 200 },
      ),
    );

    const results = await search("test");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("s=test");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("post_type=wp-manga");
    expect(results).toEqual([
      {
        sourceId: "test-manga",
        title: "Test Manga",
        slug: "test-manga",
        coverUrl: "https://cdn.example.com/cover.jpg",
        year: null,
        status: "Ongoing",
        type: "Manhwa",
        authors: ["Author A"],
        tags: ["Action"],
        source: "madaradex",
      },
    ]);
  });

  it("parses series detail page", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `
          <html>
            <head>
              <meta property="og:description" content="Fallback desc" />
            </head>
            <body>
              <div class="post-title"><h1>Test Manga</h1></div>
              <div class="summary_image"><img data-src="https://cdn.example.com/cover.jpg" /></div>
              <div class="summary__content"><div class="manga-excerpt">A great manga about testing.</div></div>
              <div class="author-content"><a href="/manga-author/author-a/">Author A</a></div>
              <div class="genres-content"><a href="/manga-genre/drama/">Drama</a></div>
              <div class="post-status">
                <div class="summary-content">Ongoing</div>
              </div>
              <div class="post-content_item">
                <div class="summary-heading">Type</div>
                <div class="summary-content">Manga</div>
              </div>
              <div class="post-content_item">
                <div class="summary-heading">Release</div>
                <div class="summary-content">2023</div>
              </div>
            </body>
          </html>
        `,
        { status: 200 },
      ),
    );

    const detail = await getSeriesDetail("test-manga");

    expect(detail).toEqual({
      sourceId: "test-manga",
      title: "Test Manga",
      slug: "test-manga",
      coverUrl: "https://cdn.example.com/cover.jpg",
      description: "A great manga about testing.",
      authors: ["Author A"],
      tags: ["Drama"],
      type: "Manga",
      status: "Ongoing",
      year: 2023,
      isAdult: true,
      isOfficial: false,
      anilistUrl: null,
      relatedSeries: [],
    });
  });

  it("returns chapters in ascending order from AJAX response", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `
          <ul class="main">
            <li class="wp-manga-chapter">
              <a href="https://madaradex.org/title/test-manga/chapter-10/">Chapter 10</a>
              <span class="chapter-release-date"><img alt="2 days ago" /></span>
            </li>
            <li class="wp-manga-chapter">
              <a href="https://madaradex.org/title/test-manga/chapter-9/">Chapter 9</a>
              <span class="chapter-release-date"><a title="1 week ago"></a></span>
            </li>
            <li class="wp-manga-chapter">
              <a href="https://madaradex.org/title/test-manga/chapter-8/">Chapter 8</a>
              <span class="chapter-release-date">Mar 5, 2024</span>
            </li>
          </ul>
        `,
        { status: 200 },
      ),
    );

    const now = Date.now();
    const chapters = await getChapterList("test-manga");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/ajax/chapters/");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");

    expect(chapters).toHaveLength(3);
    expect(chapters[0]).toMatchObject({
      sourceChapterId: "test-manga/chapter-8",
      chapterNo: 8,
      title: "Chapter 8",
      publishedAt: Date.parse("Mar 5, 2024"),
    });
    expect(chapters[1]).toMatchObject({
      sourceChapterId: "test-manga/chapter-9",
      chapterNo: 9,
      title: "Chapter 9",
    });
    // "1 week ago" ≈ now - 7d
    expect(chapters[1]!.publishedAt!).toBeGreaterThan(now - 8 * 24 * 60 * 60 * 1000);
    expect(chapters[1]!.publishedAt!).toBeLessThan(now - 6 * 24 * 60 * 60 * 1000);
    expect(chapters[2]).toMatchObject({
      sourceChapterId: "test-manga/chapter-10",
      chapterNo: 10,
      title: "Chapter 10",
    });
    // "2 days ago" ≈ now - 2d
    expect(chapters[2]!.publishedAt!).toBeGreaterThan(now - 3 * 24 * 60 * 60 * 1000);
    expect(chapters[2]!.publishedAt!).toBeLessThan(now - 1 * 24 * 60 * 60 * 1000);
  });

  it("extracts page images from reading content", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `
          <div class="reading-content">
            <div class="page-break">
              <img data-src=" https://cdn.example.com/page-1.jpg " />
            </div>
            <div class="page-break">
              <img src="https://cdn.example.com/page-2.jpg" />
            </div>
            <img src="/logo.png" />
          </div>
        `,
        { status: 200 },
      ),
    );

    const pages = await getChapterPages("test-manga/chapter-1");

    expect(pages).toEqual([
      { index: 0, imageUrl: "https://cdn.example.com/page-1.jpg" },
      { index: 1, imageUrl: "https://cdn.example.com/page-2.jpg" },
    ]);
  });

  it("surfaces upstream failures", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503, statusText: "Down" }));

    await expect(search("broken")).rejects.toThrow(
      "MadaraDex request failed: 503 Down",
    );
  });

  it("retries transient failures before succeeding", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("nope", { status: 503, statusText: "Down" }))
      .mockResolvedValueOnce(
        new Response(
          `
            <div class="c-tabs-item__content">
              <a href="https://madaradex.org/title/retry-manga/">
                <img src="https://cdn.example.com/cover.jpg" />
              </a>
              <div class="post-title"><a href="https://madaradex.org/title/retry-manga/">Retry Manga</a></div>
            </div>
          `,
          { status: 200 },
        ),
      );

    const results = await search("retry");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      expect.objectContaining({
        sourceId: "retry-manga",
        title: "Retry Manga",
        source: "madaradex",
      }),
    ]);
  });
});
