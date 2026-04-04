import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChapterList, getChapterPages, getSeriesDetail, search } from "./weebcentral";

const fetchMock = vi.fn();

describe("weebcentral source adapter", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("search builds the remote query and parses series cards", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `
          <article>
            <a href="/series/ABCDEF1234567890ABCDEFGH12/my-series">
              <img alt="My Series cover" />
            </a>
            <a href="/search?author=Jane+Doe">Jane Doe</a>
            <a href="/search?included_tag=Drama">Drama</a>
            <a href="/search?included_type=Manga">Manga</a>
            <a href="/search?included_status=Ongoing">Ongoing</a>
            <div>Released: 2024</div>
          </article>
          <article>
            <a href="/series/ABCDEF1234567890ABCDEFGH12/my-series">
              <img alt="Duplicate cover" />
            </a>
          </article>
        `,
        { status: 200 },
      ),
    );
    const results = await search("my query", {
      author: "Jane Doe",
      type: ["Manga"],
      status: ["Ongoing"],
      official: true,
      adult: false,
      tags: ["Drama"],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/search/data?");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("text=my+query");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("author=Jane+Doe");
    expect(results).toEqual([
      {
        sourceId: "ABCDEF1234567890ABCDEFGH12",
        title: "My Series",
        slug: "my-series",
        coverUrl: "https://temp.compsci88.com/cover/fallback/ABCDEF1234567890ABCDEFGH12.jpg",
        year: 2024,
        status: "Ongoing",
        type: "Manga",
        authors: ["Jane Doe"],
        tags: ["Drama"],
      },
    ]);
  });

  it("parses series detail metadata and related entries", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `
          <html>
            <head>
              <link rel="canonical" href="https://weebcentral.com/series/ABCDEF1234567890ABCDEFGH12/the-title" />
              <meta name="description" content="Fallback description" />
            </head>
            <body>
              <h1>The Title</h1>
              <a href="/search?author=Author+One">Author One</a>
              <a href="/search?included_tag=Action">Action</a>
              <a href="/search?included_type=Manhwa">Manhwa</a>
              <a href="/search?included_status=Complete">Complete</a>
              <div>Released: 2021</div>
              <div>Adult Content: Yes</div>
              <div>Official Translation: True</div>
              <h2>Description</h2>
              <p>The real description.</p>
              <a href="https://anilist.co/manga/123">AniList</a>
              <div>
                Sequel:
                <a href="/series/ZYXWVU9876543210ZYXWVU9876/sequel-title">Sequel Title</a>
              </div>
            </body>
          </html>
        `,
        { status: 200 },
      ),
    );

    const detail = await getSeriesDetail("ABCDEF1234567890ABCDEFGH12");

    expect(detail).toEqual({
      sourceId: "ABCDEF1234567890ABCDEFGH12",
      title: "The Title",
      slug: "the-title",
      coverUrl: "https://temp.compsci88.com/cover/fallback/ABCDEF1234567890ABCDEFGH12.jpg",
      description: "The real description.",
      authors: ["Author One"],
      tags: ["Action"],
      type: "Manhwa",
      status: "Complete",
      year: 2021,
      isAdult: true,
      isOfficial: true,
      anilistUrl: "https://anilist.co/manga/123",
      relatedSeries: [
        {
          sourceId: "ZYXWVU9876543210ZYXWVU9876",
          title: "Sequel Title",
          relationship: "Sequel",
        },
      ],
    });
  });

  it("returns chapters in ascending order", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `
          <a href="/chapters/BBBBBB1234567890BBBBBBBB12">
            <span class="grow"><span>Chapter 12</span></span>
          </a>
          <a href="/chapters/AAAAAA1234567890AAAAAAAA12">
            <span class="grow"><span>Chapter 11</span></span>
          </a>
        `,
        { status: 200 },
      ),
    );

    const chapters = await getChapterList("SERIES1234567890SERIES1234");

    expect(chapters).toEqual([
      {
        sourceChapterId: "AAAAAA1234567890AAAAAAAA12",
        chapterNo: 11,
        title: "Chapter 11",
      },
      {
        sourceChapterId: "BBBBBB1234567890BBBBBBBB12",
        chapterNo: 12,
        title: "Chapter 12",
      },
    ]);
  });

  it("extracts only real page images for a chapter", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        `
          <img src="/logo.svg" />
          <img data-src="https://hot.planeptune.us/page-1.jpg" />
          <img src="https://static.comix.to/page-2.webp" />
        `,
        { status: 200 },
      ),
    );

    const pages = await getChapterPages("CHAPTER1234567890CHAPTER12");

    expect(pages).toEqual([
      { index: 0, imageUrl: "https://hot.planeptune.us/page-1.jpg" },
      { index: 1, imageUrl: "https://static.comix.to/page-2.webp" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://weebcentral.com/chapters/CHAPTER1234567890CHAPTER12/images?is_prev=False&current_page=1&reading_style=long_strip",
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: "https://weebcentral.com/chapters/CHAPTER1234567890CHAPTER12",
          "HX-Request": "true",
        }),
      }),
    );
  });

  it("surfaces upstream failures", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 503, statusText: "Down" }));

    await expect(search("broken")).rejects.toThrow(
      "WeebCentral request failed: 503 Down",
    );
  });

  it("retries transient upstream failures before succeeding", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("nope", { status: 503, statusText: "Down" }))
      .mockResolvedValueOnce(
        new Response(
          `
            <article>
              <a href="/series/ABCDEF1234567890ABCDEFGH12/my-series">
                <img alt="My Series cover" />
              </a>
            </article>
          `,
          { status: 200 },
        ),
      );

    const results = await search("retry");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      expect.objectContaining({
        sourceId: "ABCDEF1234567890ABCDEFGH12",
        title: "My Series",
      }),
    ]);
  });
});
