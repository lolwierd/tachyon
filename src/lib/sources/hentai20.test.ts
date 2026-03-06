import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache, getChapterList, getChapterPages, getSeriesDetail, search } from "./hentai20";

const fetchMock = vi.fn();

describe("hentai20 source adapter", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", fetchMock);
        fetchMock.mockReset();
        clearCache();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("search parses manga links from listing pages", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                `
          <div class="c-tabs-item__content">
            <a href="https://hentai20.io/manga/secret-class/"><img data-src="https://cdn.example.com/secret.jpg" /></a>
            <div class="post-title"><a href="https://hentai20.io/manga/secret-class/">Secret Class</a></div>
            <a href="https://hentai20.io/genres/adult/">Adult</a>
            <div class="summary-content">Ongoing</div>
          </div>
        `,
                { status: 200 },
            ),
        );

        const results = await search("secret");

        expect(results).toEqual([
            {
                sourceId: "secret-class",
                title: "Secret Class",
                slug: "secret-class",
                coverUrl: "https://cdn.example.com/secret.jpg",
                year: null,
                status: "Ongoing",
                type: "Manhwa",
                authors: [],
                tags: ["Adult"],
                source: "hentai20",
            },
        ]);
    });

    it("parses series detail metadata", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                `
          <html>
            <head>
              <meta property="og:image" content="https://cdn.example.com/secret.jpg" />
              <meta property="og:description" content="Fallback" />
            </head>
            <body>
              <div class="post-title"><h1>Secret Class</h1></div>
              <div class="summary__content"><div class="manga-excerpt">Summary text.</div></div>
              <div class="author-content"><a href="/manga-author/author-a/">Author A</a></div>
              <div class="genres-content"><a href="/genres/adult/">Adult</a></div>
              <div class="post-status"><div class="summary-content">Ongoing</div></div>
              <div>Released: 2020</div>
            </body>
          </html>
        `,
                { status: 200 },
            ),
        );

        const detail = await getSeriesDetail("secret-class");

        expect(detail).toEqual({
            sourceId: "secret-class",
            title: "Secret Class",
            slug: "secret-class",
            coverUrl: "https://cdn.example.com/secret.jpg",
            description: "Summary text.",
            authors: ["Author A"],
            tags: ["Adult"],
            type: "Manhwa",
            status: "Ongoing",
            year: 2020,
            isAdult: true,
            isOfficial: false,
            anilistUrl: null,
            relatedSeries: [],
        });
    });

    it("prefers series thumb cover when og:image is missing", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                `
                    <html>
                        <head>
                            <meta property="og:description" content="Fallback" />
                        </head>
                        <body>
                            <img src="https://hentai20.io/wp-content/uploads/logo.png" />
                            <div class="bigcover">
                                <div class="bigbanner img-blur" style="background-image: url('https://hentai20.io/wp-content/uploads/2024/08/sexual-exploits-01-193x278.jpg');"></div>
                            </div>
                            <div class="seriestucontl">
                                <div class="thumb">
                                    <img src="https://hentai20.io/wp-content/uploads/2024/08/sexual-exploits-01-193x278.jpg" class="wp-post-image" />
                                </div>
                            </div>
                            <div class="post-title"><h1>Sexual Exploits</h1></div>
                            <div class="summary__content"><div class="manga-excerpt">Summary text.</div></div>
                            <div class="post-status"><div class="summary-content">Ongoing</div></div>
                        </body>
                    </html>
                `,
                { status: 200 },
            ),
        );

        const detail = await getSeriesDetail("sexual-exploits");

        expect(detail.coverUrl).toBe("https://hentai20.io/wp-content/uploads/2024/08/sexual-exploits-01-193x278.jpg");
        expect(detail.title).toBe("Sexual Exploits");
    });

    it("returns chapters in ascending order from AJAX list", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                `
          <ul>
            <li class="wp-manga-chapter"><a href="https://hentai20.io/secret-class-chapter-10/">Chapter 10</a></li>
            <li class="wp-manga-chapter"><a href="https://hentai20.io/secret-class-chapter-9/">Chapter 9</a></li>
          </ul>
        `,
                { status: 200 },
            ),
        );

        const chapters = await getChapterList("secret-class");

        expect(chapters).toEqual([
            {
                sourceChapterId: "secret-class-chapter-9",
                chapterNo: 9,
                title: "Chapter 9",
            },
            {
                sourceChapterId: "secret-class-chapter-10",
                chapterNo: 10,
                title: "Chapter 10",
            },
        ]);
    });

    it("falls back to series page chapters when AJAX endpoint returns 404", async () => {
        fetchMock
            .mockResolvedValueOnce(new Response("missing", { status: 404, statusText: "Not Found" }))
            .mockResolvedValueOnce(
                new Response(
                    `
              <ul>
                <li class="wp-manga-chapter"><a href="https://hentai20.io/sexual-exploits-chapter-2/">Chapter 2</a></li>
                <li class="wp-manga-chapter"><a href="https://hentai20.io/sexual-exploits-chapter-1/">Chapter 1</a></li>
              </ul>
            `,
                    { status: 200 },
                ),
            );

        const chapters = await getChapterList("sexual-exploits");

        expect(chapters).toEqual([
            {
                sourceChapterId: "sexual-exploits-chapter-1",
                chapterNo: 1,
                title: "Chapter 1",
            },
            {
                sourceChapterId: "sexual-exploits-chapter-2",
                chapterNo: 2,
                title: "Chapter 2",
            },
        ]);

        const ajaxCallsAfterFirstRequest = fetchMock.mock.calls.filter((call) =>
            String(call[0]).includes("/ajax/chapters/"),
        );
        expect(ajaxCallsAfterFirstRequest).toHaveLength(1);

        await getChapterList("sexual-exploits");

        const ajaxCallsAfterSecondRequest = fetchMock.mock.calls.filter((call) =>
            String(call[0]).includes("/ajax/chapters/"),
        );
        expect(ajaxCallsAfterSecondRequest).toHaveLength(1);
    });

    it("extracts chapter pages from reader HTML", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                `
          <div class="reading-content">
            <img src="https://hentai20.io/logo.png" />
            <img data-src="https://cdn.example.com/secret-class/10/1.jpg" />
            <img src="https://cdn.example.com/secret-class/10/2.jpg" />
          </div>
        `,
                { status: 200 },
            ),
        );

        const pages = await getChapterPages("secret-class-chapter-10");

        expect(pages).toEqual([
            { index: 0, imageUrl: "https://cdn.example.com/secret-class/10/1.jpg" },
            { index: 1, imageUrl: "https://cdn.example.com/secret-class/10/2.jpg" },
        ]);
    });

    it("throws when chapter gets redirected to interstitial HTML", async () => {
        fetchMock.mockResolvedValue(
            new Response("<html>redirected to coosync.com</html>", { status: 200 }),
        );

        await expect(getChapterPages("secret-class-chapter-10")).rejects.toThrow(
            "No chapter pages found",
        );
    });

    it("surfaces upstream failures", async () => {
        fetchMock.mockResolvedValue(new Response("nope", { status: 503, statusText: "Down" }));

        await expect(search("broken")).rejects.toThrow(
            "Hentai20 request failed: 503 Down",
        );
    });
});
