import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache, getChapterList, getChapterPages, getSeriesDetail, search } from "./toonily";

const fetchMock = vi.fn();

describe("toonily source adapter", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", fetchMock);
        fetchMock.mockReset();
        clearCache();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("search parses Toonily API search responses", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                `
                    <div class="novel__item">
                        <div class="novel__item-inner">
                            <div class="novel__item-icon">
                                <a title="Secret Class" href="/secret-class">
                                    <img src="//sb.toonilycdnv2.xyz/thumb/7fb13916b773a0360936906c5459fc9e.png" alt="Secret Class" />
                                </a>
                            </div>
                            <div class="novel__item-meta">
                                <div class="name">
                                    <h3><a title="Secret Class" href="/secret-class"><span>Secret</span> <span>Class</span></a></h3>
                                </div>
                            </div>
                        </div>
          </div>
                    <div class="novel__item">
                        <div class="novel__item-inner">
                            <div class="novel__item-icon">
                                <a title="Secret Class" href="/secret-class">
                                    <img src="//sb.toonilycdnv2.xyz/thumb/dupe.png" alt="Secret Class" />
                                </a>
                            </div>
                        </div>
          </div>
        `,
                { status: 200 },
            ),
        );

        const results = await search("secret");

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(results).toEqual([
            {
                sourceId: "secret-class",
                title: "Secret Class",
                slug: "secret-class",
                coverUrl: "https://sb.toonilycdnv2.xyz/thumb/7fb13916b773a0360936906c5459fc9e.png",
                year: null,
                status: "",
                type: "Manhwa",
                authors: [],
                tags: [],
                source: "toonily",
            },
        ]);
    });

    it("parses series detail metadata", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                `
          <html>
            <head>
              <meta property="og:image" content="https://sb.toonilycdnv2.xyz/thumb/secret.png" />
              <meta property="og:description" content="Fallback description" />
            </head>
            <body>
              <h1>Secret Class</h1>
              <div class="summary__content"><div class="manga-excerpt">Real summary.</div></div>
              <a href="/authors/wang-kang-cheol">Wang Kang Cheol</a>
              <a href="/genres/adult">Adult</a>
              <a href="/status/ONGOING">ONGOING</a>
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
            coverUrl: "https://sb.toonilycdnv2.xyz/thumb/secret.png",
            description: "Real summary.",
            authors: ["Wang Kang Cheol"],
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

    it("returns chapter list in ascending order", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                `
          <a href="https://toonily.me/secret-class/chapter-10">CHAPTER 10</a>
          <a href="https://toonily.me/secret-class/chapter-9">CHAPTER 9</a>
        `,
                { status: 200 },
            ),
        );

        const chapters = await getChapterList("secret-class");

        expect(chapters).toEqual([
            {
                sourceChapterId: "secret-class/chapter-9",
                chapterNo: 9,
                title: "CHAPTER 9",
            },
            {
                sourceChapterId: "secret-class/chapter-10",
                chapterNo: 10,
                title: "CHAPTER 10",
            },
        ]);
    });

    it("extracts chapter page images", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                `
          <div class="reading-content">
            <img src="/logo.png" />
            <img data-src="https://s1.toonilycdnv2.xyz/secret-class/10/1.jpg" />
            <img src="https://s1.toonilycdnv2.xyz/secret-class/10/2.jpg" />
          </div>
        `,
                { status: 200 },
            ),
        );

        const pages = await getChapterPages("secret-class/chapter-10");

        expect(pages).toEqual([
            { index: 0, imageUrl: "https://s1.toonilycdnv2.xyz/secret-class/10/1.jpg" },
            { index: 1, imageUrl: "https://s1.toonilycdnv2.xyz/secret-class/10/2.jpg" },
        ]);
    });

    it("surfaces upstream failures", async () => {
        fetchMock.mockResolvedValue(new Response("nope", { status: 503, statusText: "Down" }));

        await expect(search("broken")).rejects.toThrow(
            "Toonily request failed: 503 Down",
        );
    });
});
