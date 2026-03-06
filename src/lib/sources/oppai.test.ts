import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache, getChapterList, getChapterPages, getSeriesDetail, search } from "./oppai";

const fetchMock = vi.fn();

describe("oppai source adapter", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", fetchMock);
        fetchMock.mockReset();
        clearCache();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("search parses manhwa results", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                `
                    <div class='in-grid read-over read-wrap-no'>
                        <a href='https://read.oppai.stream/manhwa?m=wireless-onahole' class='in-grid-wrap'>
                            <div class='img-wrap'>
                                <img class='read-cover' src='https://myspacecat.pictures/manhwa/wireless-onahole/cover.png?v=2025-12-28 12:01:00' alt='Wireless Onahole cover on oppai.stream' />
                            </div>
                            <div class='read-info'>
                                <h3 class='white bebas line-2 man-title'>Wireless Onahole</h3>
                            </div>
                        </a>
                    </div>
                    <div class='in-grid read-over read-wrap-no'>
                        <a href='https://read.oppai.stream/manhwa?m=wireless-onahole' class='in-grid-wrap'>
                            <div class='read-info'>
                                <h3 class='white bebas line-2 man-title'>Duplicate</h3>
                            </div>
                        </a>
                    </div>
        `,
                { status: 200 },
            ),
        );

        const results = await search("wireless");

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(results).toEqual([
            {
                sourceId: "wireless-onahole",
                title: "Wireless Onahole",
                slug: "wireless-onahole",
                coverUrl: "https://myspacecat.pictures/manhwa/wireless-onahole/cover.png?v=2025-12-28%2012:01:00",
                year: null,
                status: "",
                type: "Manhwa",
                authors: [],
                tags: [],
                source: "oppai",
            },
        ]);
    });

    it("parses series detail page", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                `
          <html>
            <head>
              <meta property="og:image" content="https://myspacecat.pictures/manhwa/wireless-onahole/cover.png" />
              <meta property="og:description" content="Series description" />
            </head>
            <body>
              <h1>Wireless Onahole By Swehwangjorongie</h1>
              <div>Updating</div>
            </body>
          </html>
        `,
                { status: 200 },
            ),
        );

        const detail = await getSeriesDetail("wireless-onahole");

        expect(detail).toEqual({
            sourceId: "wireless-onahole",
            title: "Wireless Onahole",
            slug: "wireless-onahole",
            coverUrl: "https://myspacecat.pictures/manhwa/wireless-onahole/cover.png",
            description: "Series description",
            authors: ["Swehwangjorongie"],
            tags: [],
            type: "Manhwa",
            status: "Ongoing",
            year: null,
            isAdult: true,
            isOfficial: false,
            anilistUrl: null,
            relatedSeries: [],
        });
    });

    it("returns chapter list in ascending order", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                `
          <a href="https://read.oppai.stream/page?m=wireless-onahole&c=2">2</a>
          <a href="https://read.oppai.stream/page?m=wireless-onahole&c=1">1</a>
        `,
                { status: 200 },
            ),
        );

        const chapters = await getChapterList("wireless-onahole");

        expect(chapters).toEqual([
            {
                sourceChapterId: "wireless-onahole/1",
                chapterNo: 1,
                title: "Chapter 1",
            },
            {
                sourceChapterId: "wireless-onahole/2",
                chapterNo: 2,
                title: "Chapter 2",
            },
        ]);
    });

    it("extracts chapter pages from chapter HTML", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                `
          <img src="https://oppai.stream/assets/logo.png" />
          <img src="https://myspacecat.pictures/manhwa/wireless-onahole/63/1.jpg?v=" />
          <img src="https://myspacecat.pictures/manhwa/wireless-onahole/63/2.jpg?v=" />
        `,
                { status: 200 },
            ),
        );

        const pages = await getChapterPages("wireless-onahole/63");

        expect(pages).toEqual([
            { index: 0, imageUrl: "https://myspacecat.pictures/manhwa/wireless-onahole/63/1.jpg?v=" },
            { index: 1, imageUrl: "https://myspacecat.pictures/manhwa/wireless-onahole/63/2.jpg?v=" },
        ]);
    });

    it("falls back to page endpoint when infinite-page has no images", async () => {
        fetchMock
            .mockResolvedValueOnce(new Response("<div>no images</div>", { status: 200 }))
            .mockResolvedValueOnce(
                new Response(
                    `
          <img src="https://myspacecat.pictures/manhwa/wireless-onahole/63/1.jpg?v=" />
          <img src="https://myspacecat.pictures/manhwa/wireless-onahole/63/2.jpg?v=" />
        `,
                    { status: 200 },
                ),
            );

        const pages = await getChapterPages("wireless-onahole/63");

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/infinite-page?m=wireless-onahole&c=63");
        expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/page?m=wireless-onahole&c=63");
        expect(pages).toEqual([
            { index: 0, imageUrl: "https://myspacecat.pictures/manhwa/wireless-onahole/63/1.jpg?v=" },
            { index: 1, imageUrl: "https://myspacecat.pictures/manhwa/wireless-onahole/63/2.jpg?v=" },
        ]);
    });

    it("extracts chapter pages from the inline script loader when static tags are absent", async () => {
        fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.includes("/infinite-page?m=wireless-onahole&c=63")) {
                return Promise.resolve(
                    new Response(
                        `
                        <script>
                          var folder = "wireless-onahole";
                          var currentChapter = 63;
                          var urlfor = "https://myspacecat.pictures/manhwa/images.php?f-m="+folder+"&c="+currentChapter;
                          function loadNextImage() {}
                        </script>
                    `,
                        { status: 200 },
                    ),
                );
            }

            if (url === "https://myspacecat.pictures/manhwa/images.php?f-m=wireless-onahole&c=63") {
                return Promise.resolve(new Response("3", { status: 200 }));
            }

            if (url === "https://myspacecat.pictures/manhwa/wireless-onahole/63/1.jpg") {
                return Promise.resolve(new Response(null, { status: 200 }));
            }

            return Promise.resolve(new Response("not found", { status: 404, statusText: "Not Found" }));
        });

        const pages = await getChapterPages("wireless-onahole/63");

        expect(fetchMock).toHaveBeenCalledWith(
            "https://myspacecat.pictures/manhwa/wireless-onahole/63/1.jpg",
            expect.objectContaining({ method: "HEAD" }),
        );
        expect(
            fetchMock.mock.calls.some(([input]) => String(input).includes("/page?m=wireless-onahole&c=63")),
        ).toBe(false);
        expect(pages).toEqual([
            { index: 0, imageUrl: "https://myspacecat.pictures/manhwa/wireless-onahole/63/1.jpg" },
            { index: 1, imageUrl: "https://myspacecat.pictures/manhwa/wireless-onahole/63/2.jpg" },
            { index: 2, imageUrl: "https://myspacecat.pictures/manhwa/wireless-onahole/63/3.jpg" },
        ]);
    });

    it("throws when no chapter page images are found", async () => {
        fetchMock
            .mockResolvedValueOnce(new Response("<div>no images</div>", { status: 200 }))
            .mockResolvedValueOnce(new Response("<div>still no images</div>", { status: 200 }));

        await expect(getChapterPages("wireless-onahole/63")).rejects.toThrow(
            "No chapter pages found for wireless-onahole/63",
        );
    });

    it("surfaces upstream failures", async () => {
        fetchMock.mockResolvedValue(new Response("nope", { status: 503, statusText: "Down" }));

        await expect(search("broken")).rejects.toThrow(
            "Oppai request failed: 503 Down",
        );
    });
});
