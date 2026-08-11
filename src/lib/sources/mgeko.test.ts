import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCache,
  getChapterList,
  getChapterPages,
  getSeriesDetail,
  search,
} from "./mgeko";
import { getSource } from "./registry";

const fetchMock = vi.fn();

describe("mgeko source adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    clearCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches by keyword and parses server-rendered result cards", async () => {
    fetchMock.mockResolvedValue(
      new Response(`
        <ul class="novel-list grid col col2">
          <li class="novel-item">
            <a href="/manga/test-manga/" title="Test Manga">
              <img src="/static/img/loading.gif" data-src="/media/manga_covers/test.jpg" />
              <h4 class="novel-title">Test Manga</h4>
              <h6>Author(S): Author A; Author B</h6>
            </a>
          </li>
          <li class="novel-item">
            <a href="https://www.mgeko.cc/manga/test-manga/" title="Duplicate">
              <img data-src="https://imgsrv5.com/avatar/cover.jpg" />
              <h4 class="novel-title">Duplicate</h4>
            </a>
          </li>
          <li class="novel-item">
            <a href="/manga/second-manga/" title="Second Manga">
              <img src="https://imgsrv5.com/second.jpg" />
              <h4 class="novel-title">Second Manga</h4>
              <h6>Author(S): Updating</h6>
            </a>
          </li>
        </ul>
      `, { status: 200 }),
    );

    const results = await search("test manga");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://www.mgeko.cc/search/?search=test+manga",
    );
    expect(results).toEqual([
      {
        sourceId: "test-manga",
        title: "Test Manga",
        slug: "test-manga",
        coverUrl: "https://www.mgeko.cc/media/manga_covers/test.jpg",
        year: null,
        status: "",
        type: "",
        authors: ["Author A", "Author B"],
        tags: [],
        source: "mgeko",
      },
      {
        sourceId: "second-manga",
        title: "Second Manga",
        slug: "second-manga",
        coverUrl: "https://imgsrv5.com/second.jpg",
        year: null,
        status: "",
        type: "",
        authors: [],
        tags: [],
        source: "mgeko",
      },
    ]);
  });

  it("uses Mgeko's native filtered browse endpoint without detail N+1 requests", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      results_html: `
        <article class="comic-card">
          <a href="/manga/test-manga/"><img src="/media/manga_covers/test.jpg" /></a>
          <h3 class="comic-card__title"><a href="/manga/test-manga/">Test Manga</a></h3>
        </article>
      `,
    }), { status: 200 }));

    await expect(search("test manga", {
      type: ["Manhwa"],
      status: ["Complete"],
      author: "author a",
    })).resolves.toEqual([
      {
        sourceId: "test-manga",
        title: "Test Manga",
        slug: "test-manga",
        coverUrl: "https://www.mgeko.cc/media/manga_covers/test.jpg",
        year: null,
        status: "Complete",
        type: "Manhwa",
        authors: [],
        tags: [],
        source: "mgeko",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://www.mgeko.cc/browse-comics/data/?q=test+manga+author+a&status=completed&type=manhwa",
    );
  });

  it("uses the latest-updates page for an empty search", async () => {
    fetchMock.mockResolvedValue(
      new Response(`
        <ul class="novel-list chapters">
          <li class="novel-item">
            <a class="list-body" href="/manga/latest-series/" title="Latest Series">
              <img data-src="https://imgsrv5.com/latest.jpg" />
              <h4 class="novel-title">Latest Series</h4>
              <h6>Author(S): Author</h6>
            </a>
          </li>
        </ul>
      `, { status: 200 }),
    );

    const results = await search("");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://www.mgeko.cc/jumbo/manga/?filter=All",
    );
    expect(results[0]).toMatchObject({
      sourceId: "latest-series",
      title: "Latest Series",
      coverUrl: "https://imgsrv5.com/latest.jpg",
    });
  });

  it("does not broaden unsupported metadata filters into an unfiltered browse", async () => {
    await expect(search("test manga", { status: ["Canceled"] })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses detail metadata, status, categories, tags, and the CDN cover", async () => {
    fetchMock.mockResolvedValue(
      new Response(`
        <html>
          <head>
            <meta name="description" content="Fallback description" />
            <meta property="og:image" content="/fallback.jpg" />
          </head>
          <body>
            <article id="novel">
              <figure class="cover">
                <img data-src="https://imgsrv5.com/avatar/288x412/cover.jpg" />
              </figure>
              <h1 class="novel-title">Test Manga</h1>
              <div class="author">
                <a class="property-item"><span itemprop="author">Author A</span></a>
                <a class="property-item"><span itemprop="author">Author B</span></a>
              </div>
              <div class="header-stats">
                <span><strong class="completed">Completed</strong><small>Status</small></span>
              </div>
              <div class="categories">
                <ul>
                  <li><a>Action</a></li>
                  <li><a>manhwa</a></li>
                </ul>
              </div>
              <section id="info">
                <p class="description">A <strong>great</strong> manga.\n With a summary.</p>
                <div class="manga-tags">
                  <span class="selected-pin">Action</span>
                  <span class="selected-pin">Fantasy</span>
                </div>
              </section>
            </article>
          </body>
        </html>
      `, { status: 200 }),
    );

    await expect(getSeriesDetail("test-manga")).resolves.toEqual({
      sourceId: "test-manga",
      title: "Test Manga",
      slug: "test-manga",
      coverUrl: "https://imgsrv5.com/avatar/288x412/cover.jpg",
      description: "A great manga. With a summary.",
      authors: ["Author A", "Author B"],
      tags: ["Action", "manhwa", "Fantasy"],
      type: "Manhwa",
      status: "Complete",
      year: null,
      isAdult: false,
      isOfficial: false,
      anilistUrl: null,
      relatedSeries: [],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://www.mgeko.cc/manga/test-manga/");
  });

  it("parses all chapters, dates, decimal numbers, and non-numeric labels in ascending order", async () => {
    fetchMock.mockResolvedValue(
      new Response(`
        <ul class="chapter-list">
          <li>
            <a href="/reader/en/test-chapter-10-eng-li/"><strong class="chapter-title">10-eng-li</strong><time datetime="May 1, 2024, 1:00 p.m.">1 year</time></a>
          </li>
          <li>
            <a href="/reader/en/test-chapter-2-side-story-1-eng-li/"><strong class="chapter-title">2-side-story-1-eng-li</strong><time datetime="April 1, 2024, 1:00 p.m.">1 year</time></a>
          </li>
          <li>
            <a href="/reader/en/test-chapter-2-5-eng-li/"><strong class="chapter-title">2.5-eng-li</strong><time>2 weeks ago</time></a>
          </li>
          <li>
            <a href="/reader/en/test-chapter-announcement-eng-li/" title="Chapter test-chapter-announcement-eng-li"><strong class="chapter-title">announcement-eng-li</strong></a>
          </li>
        </ul>
      `, { status: 200 }),
    );

    const chapters = await getChapterList("test");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://www.mgeko.cc/manga/test/all-chapters/",
    );
    expect(chapters).toEqual([
      {
        sourceChapterId: "test/test-chapter-announcement-eng-li",
        chapterNo: 0,
        title: "Chapter announcement",
        publishedAt: null,
      },
      {
        sourceChapterId: "test/test-chapter-2-side-story-1-eng-li",
        chapterNo: 2,
        title: "Chapter 2-side-story-1",
        publishedAt: Date.parse("April 1, 2024, 1:00 pm"),
      },
      {
        sourceChapterId: "test/test-chapter-2-5-eng-li",
        chapterNo: 2.5,
        title: "Chapter 2.5",
        publishedAt: expect.any(Number),
      },
      {
        sourceChapterId: "test/test-chapter-10-eng-li",
        chapterNo: 10,
        title: "Chapter 10",
        publishedAt: Date.parse("May 1, 2024, 1:00 pm"),
      },
    ]);
  });

  it("parses hyphenated decimal chapter labels from live Mgeko markup", async () => {
    fetchMock.mockResolvedValue(
      new Response(`
        <ul class="chapter-list">
          <li>
            <a href="/reader/en/test-chapter-179-5-eng-li/"><strong class="chapter-title">179-5-eng-li</strong></a>
          </li>
          <li>
            <a href="/reader/en/test-chapter-179-eng-li/"><strong class="chapter-title">179-eng-li</strong></a>
          </li>
        </ul>
      `, { status: 200 }),
    );

    await expect(getChapterList("test")).resolves.toMatchObject([
      {
        sourceChapterId: "test/test-chapter-179-eng-li",
        chapterNo: 179,
        title: "Chapter 179",
      },
      {
        sourceChapterId: "test/test-chapter-179-5-eng-li",
        chapterNo: 179.5,
        title: "Chapter 179.5",
      },
    ]);
  });

  it("extracts reader images in order and ignores the site credit image", async () => {
    fetchMock.mockResolvedValue(
      new Response(`
        <div id="chapter-reader">
          <img src="https://imgsrv5.com/pages/0.jpg" />
          <img data-src="https://imgsrv5.com/pages/1.jpg" />
          <img src="https://imgsrv5.com/credits-mgeko.png" />
          <img src="/static/img/logo.png" />
        </div>
        <img src="https://imgsrv5.com/outside-reader.jpg" />
      `, { status: 200 }),
    );

    const pages = await getChapterPages("test/test-chapter-1-eng-li");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://www.mgeko.cc/reader/en/test-chapter-1-eng-li/",
    );
    expect(pages).toEqual([
      { index: 0, imageUrl: "https://imgsrv5.com/pages/0.jpg" },
      { index: 1, imageUrl: "https://imgsrv5.com/pages/1.jpg" },
    ]);
  });

  it("rejects malformed source identifiers before making a request", async () => {
    await expect(getSeriesDetail("bad/slug")).rejects.toThrow(
      'Mgeko: invalid series slug: "bad/slug"',
    );
    await expect(getChapterPages("bad-chapter-id")).rejects.toThrow(
      'Mgeko: invalid chapterSourceId: "bad-chapter-id"',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("provides the reader URL used as the media referer", () => {
    expect(getSource("mgeko")?.getSeriesUrl?.("test-manga")).toBe(
      "https://www.mgeko.cc/manga/test-manga/",
    );
    expect(getSource("mgeko")?.getChapterUrl?.("test/test-chapter-1-eng-li")).toBe(
      "https://www.mgeko.cc/reader/en/test-chapter-1-eng-li/",
    );
  });

  it("surfaces upstream failures", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503, statusText: "Down" }));

    await expect(search("broken")).rejects.toThrow(
      "Mgeko request failed: 503 Down",
    );
  });
});
