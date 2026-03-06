import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache, getChapterList, getChapterPages, getSeriesDetail, search } from "./manhwa18";

const fetchMock = vi.fn();

function encodeDataPage(payload: unknown) {
    return JSON.stringify(payload)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function htmlWithPayload(payload: unknown) {
    return `<div id="app" data-page="${encodeDataPage(payload)}"></div>`;
}

describe("manhwa18 source adapter", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", fetchMock);
        fetchMock.mockReset();
        clearCache();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("search parses action/search JSON payload", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                JSON.stringify({
                    data: [
                        {
                            slug: "secret-class",
                            name: "Secret Class",
                            cover_url: "https://cdn.example.com/secret-class.jpg",
                            thumb_url: "https://cdn.example.com/secret-class-thumb.jpg",
                        },
                    ],
                }),
                { status: 200 },
            ),
        );

        const results = await search("secret");

        expect(results).toEqual([
            {
                sourceId: "secret-class",
                title: "Secret Class",
                slug: "secret-class",
                coverUrl: "https://cdn.example.com/secret-class.jpg",
                year: null,
                status: "",
                type: "Manhwa",
                authors: [],
                tags: [],
                source: "manhwa18",
            },
        ]);
    });

    it("search falls back to Inertia manga-list payload", async () => {
        fetchMock
            .mockResolvedValueOnce(new Response("{invalid-json", { status: 200 }))
            .mockResolvedValueOnce(
                new Response(
                    htmlWithPayload({
                        component: "MangaList",
                        props: {
                            paginate: {
                                data: [
                                    {
                                        slug: "secret-class",
                                        name: "Secret Class",
                                        cover_url: "https://cdn.example.com/secret-class.jpg",
                                        status_id: 1,
                                        genres: [{ name: "Adult" }, { name: "Drama" }],
                                    },
                                ],
                            },
                        },
                    }),
                    { status: 200 },
                ),
            );

        const results = await search("secret");

        expect(results).toEqual([
            {
                sourceId: "secret-class",
                title: "Secret Class",
                slug: "secret-class",
                coverUrl: "https://cdn.example.com/secret-class.jpg",
                year: null,
                status: "Ongoing",
                type: "Manhwa",
                authors: [],
                tags: ["Adult", "Drama"],
                source: "manhwa18",
            },
        ]);
    });

    it("parses series detail payload", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                htmlWithPayload({
                    component: "MangaDetail",
                    props: {
                        manga: {
                            slug: "secret-class",
                            name: "Secret Class",
                            cover_url: "https://cdn.example.com/secret-class.jpg",
                            description: "<p>A dramatic summary.</p>",
                            status_id: 1,
                            year: 2020,
                            genres: [{ name: "Adult" }],
                            authors: [{ name: "Writer" }],
                        },
                    },
                }),
                { status: 200 },
            ),
        );

        const detail = await getSeriesDetail("secret-class");

        expect(detail).toEqual({
            sourceId: "secret-class",
            title: "Secret Class",
            slug: "secret-class",
            coverUrl: "https://cdn.example.com/secret-class.jpg",
            description: "A dramatic summary.",
            authors: ["Writer"],
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

    it("returns chapter list from manga payload", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                htmlWithPayload({
                    component: "MangaDetail",
                    props: {
                        manga: {
                            slug: "secret-class",
                            chapters: [
                                { slug: "chapter-2", name: "Chap. 2" },
                                { slug: "chapter-1", name: "Chap. 1" },
                            ],
                        },
                    },
                }),
                { status: 200 },
            ),
        );

        const chapters = await getChapterList("secret-class");

        expect(chapters).toEqual([
            {
                sourceChapterId: "secret-class/chapter-1",
                chapterNo: 1,
                title: "Chap. 1",
            },
            {
                sourceChapterId: "secret-class/chapter-2",
                chapterNo: 2,
                title: "Chap. 2",
            },
        ]);
    });

    it("returns chapter list from props.chapters payload shape", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                htmlWithPayload({
                    component: "MangaDetail",
                    props: {
                        manga: {
                            slug: "secret-class",
                        },
                        chapters: [
                            { slug: "chap-2-7", name: "chap 2" },
                            { slug: "chap-1-3", name: "chap 1" },
                        ],
                    },
                }),
                { status: 200 },
            ),
        );

        const chapters = await getChapterList("secret-class");

        expect(chapters).toEqual([
            {
                sourceChapterId: "secret-class/chap-1-3",
                chapterNo: 1,
                title: "chap 1",
            },
            {
                sourceChapterId: "secret-class/chap-2-7",
                chapterNo: 2,
                title: "chap 2",
            },
        ]);
    });

    it("extracts chapter page URLs from payload", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                htmlWithPayload({
                    component: "ChapterDetail",
                    props: {
                        chapter: {
                            images: [
                                "https://cdn.example.com/chapters/secret-class/1/1.jpg",
                                "https://cdn.example.com/chapters/secret-class/1/2.jpg",
                            ],
                        },
                    },
                }),
                { status: 200 },
            ),
        );

        const pages = await getChapterPages("secret-class/chapter-1");

        expect(pages).toEqual([
            { index: 0, imageUrl: "https://cdn.example.com/chapters/secret-class/1/1.jpg" },
            { index: 1, imageUrl: "https://cdn.example.com/chapters/secret-class/1/2.jpg" },
        ]);
    });

    it("extracts chapter page URLs from props.chapterContent html", async () => {
        fetchMock.mockResolvedValue(
            new Response(
                htmlWithPayload({
                    component: "ChapterDetail",
                    props: {
                        chapterContent:
                            '<img src="https://cdn.pornwa.us//643/1/first.jpg" loading="lazy" />'
                            + '<img src="https://cdn.pornwa.us//643/1/second.jpg" loading="lazy" />',
                        mangaCover: "https://manhwa18.net/storage/images/raw/cover.jpg",
                    },
                }),
                { status: 200 },
            ),
        );

        const pages = await getChapterPages("secret-class/chap-01-361");

        expect(pages).toEqual([
            { index: 0, imageUrl: "https://cdn.pornwa.us//643/1/first.jpg" },
            { index: 1, imageUrl: "https://cdn.pornwa.us//643/1/second.jpg" },
        ]);
    });

    it("surfaces upstream failures", async () => {
        fetchMock.mockResolvedValue(new Response("nope", { status: 503, statusText: "Down" }));

        await expect(search("broken")).rejects.toThrow(
            "Manhwa18 request failed: 503 Down",
        );
    });
});
