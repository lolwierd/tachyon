import * as cheerio from "cheerio";
import type {
    SearchResult,
    SeriesDetail,
    Chapter,
    ChapterPage,
    SearchOptions,
} from "./types";
import { registerSource } from "./registry";
import { logError, logWarn } from "@/lib/server/log";
import { pruneResponseCache } from "./fetcher";

const BASE_URL = "https://hentai20.io";
const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 600;

type FetchOptions = { method?: string; body?: string; referer?: string };

let lastRequestTime = 0;
let requestQueue: Promise<void> = Promise.resolve();
const responseCache = new Map<string, { expiresAt: number; value: string }>();
const inflightRequests = new Map<string, Promise<string>>();
const ajaxChapterEndpointMissing = new Set<string>();

export function clearCache() {
    responseCache.clear();
    inflightRequests.clear();
    ajaxChapterEndpointMissing.clear();
    lastRequestTime = 0;
    requestQueue = Promise.resolve();
}

function getCacheKey(url: string, options?: FetchOptions) {
    return JSON.stringify({
        url,
        method: options?.method || "GET",
        body: options?.body || "",
        referer: options?.referer || "",
    });
}

async function throttledFetch(
    url: string,
    options?: FetchOptions,
    behavior?: { suppressErrorLog?: boolean },
): Promise<string> {
    const cacheKey = getCacheKey(url, options);
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
    }

    const inflight = inflightRequests.get(cacheKey);
    if (inflight) {
        return inflight;
    }

    const requestPromise = (async () => {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
            try {
                return await fetchWithThrottle(url, options, cacheKey);
            } catch (error) {
                lastError = error instanceof Error ? error : new Error("Unknown Hentai20 fetch error");

                if (isRetryableError(lastError) && attempt < MAX_RETRIES) {
                    logWarn("source.hentai20.retry", {
                        url,
                        attempt: attempt + 1,
                        message: lastError.message,
                    });
                }

                if (!isRetryableError(lastError) || attempt === MAX_RETRIES) {
                    break;
                }

                await new Promise((resolve) =>
                    setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)),
                );
            }
        }

        const finalError = lastError ?? new Error("Unknown Hentai20 fetch error");
        if (!behavior?.suppressErrorLog) {
            logError("source.hentai20.request_failed", finalError, {
                url,
                method: options?.method || "GET",
            });
        }
        throw finalError;
    })();

    inflightRequests.set(cacheKey, requestPromise);

    try {
        return await requestPromise;
    } finally {
        inflightRequests.delete(cacheKey);
    }
}

function acquireSlot(): Promise<void> {
    const slot = requestQueue.then(async () => {
        const now = Date.now();
        const elapsed = now - lastRequestTime;
        if (elapsed < REQUEST_DELAY_MS) {
            await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS - elapsed));
        }
        lastRequestTime = Date.now();
    });

    requestQueue = slot.catch(() => { });
    return slot;
}

async function fetchWithThrottle(
    url: string,
    options: FetchOptions | undefined,
    cacheKey: string,
) {
    await acquireSlot();

    const headers: Record<string, string> = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
    };

    if (options?.referer) {
        headers.Referer = options.referer;
    }

    if (options?.body) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const res = await fetch(url, {
        method: options?.method || "GET",
        headers,
        body: options?.body,
        redirect: "follow",
        signal: controller.signal,
    }).finally(() => {
        clearTimeout(timeoutId);
    });

    if (!res.ok) {
        throw new Error(`Hentai20 request failed: ${res.status} ${res.statusText} — ${url}`);
    }

    if (res.url) {
        try {
            const host = new URL(res.url).hostname.toLowerCase();
            if (!host.endsWith("hentai20.io") && !host.endsWith("www.hentai20.io")) {
                throw new Error(`Hentai20 redirected to interstitial host: ${host}`);
            }
        } catch (error) {
            if (error instanceof Error && error.message.includes("interstitial host")) {
                throw error;
            }
        }
    }

    const text = await res.text();
    responseCache.set(cacheKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        value: text,
    });
    pruneResponseCache(responseCache);

    return text;
}

function isRetryableError(error: Error) {
    if (error.name === "AbortError") {
        return true;
    }

    const message = error.message.toLowerCase();
    if (message.includes("interstitial host")) {
        return false;
    }

    return (
        message.includes("429")
        || message.includes("500")
        || message.includes("502")
        || message.includes("503")
        || message.includes("504")
        || message.includes("timeout")
        || message.includes("fetch failed")
    );
}

function toAbsoluteUrl(url: string | null | undefined) {
    if (!url) return "";
    try {
        return new URL(url, BASE_URL).toString();
    } catch {
        return "";
    }
}

function normalizeText(value: string | null | undefined) {
    return value?.replace(/\s+/g, " ").trim() ?? "";
}

function parseSeriesSlug(href: string) {
    const absolute = toAbsoluteUrl(href);
    if (!absolute) return "";

    try {
        const parsed = new URL(absolute);
        const segments = parsed.pathname
            .split("/")
            .map((segment) => segment.trim())
            .filter(Boolean);

        if (segments.length === 2 && segments[0] === "manga") {
            return segments[1]!.toLowerCase();
        }

        return "";
    } catch {
        return "";
    }
}

function parseChapterSlug(href: string) {
    const absolute = toAbsoluteUrl(href);
    if (!absolute) return "";

    try {
        const parsed = new URL(absolute);
        const parts = parsed.pathname
            .split("/")
            .map((segment) => segment.trim())
            .filter(Boolean);

        if (parts.length === 1 && parts[0]!.includes("-chapter-")) {
            return parts[0]!.toLowerCase();
        }

        return "";
    } catch {
        return "";
    }
}

function parseChapterNo(text: string): number {
    const chapterMatch = text.match(/(?:chapter|ch\.?|ep\.?|episode)\s*(\d+(?:\.\d+)?)/i);
    if (chapterMatch) {
        return Number.parseFloat(chapterMatch[1] ?? "0") || 0;
    }

    const slugMatch = text.match(/-chapter-(\d+)(?:-(\d+))?/i);
    if (!slugMatch) return 0;

    const main = slugMatch[1] ?? "0";
    const sub = slugMatch[2];
    if (sub) {
        const value = Number.parseFloat(`${main}.${sub}`);
        return Number.isFinite(value) ? value : Number.parseFloat(main) || 0;
    }

    return Number.parseFloat(main) || 0;
}

function normalizeStatus(raw: string) {
    const text = normalizeText(raw).toLowerCase();
    if (!text) return "";

    if (text.includes("ongoing")) return "Ongoing";
    if (text.includes("completed") || text.includes("complete")) return "Complete";
    if (text.includes("hiatus")) return "Hiatus";
    if (text.includes("canceled") || text.includes("cancelled")) return "Canceled";

    return normalizeText(raw);
}

function extractYear(text: string) {
    const match = text.match(/(?:released|year)\s*:?\s*(\d{4})/i);
    return match ? Number.parseInt(match[1]!, 10) : null;
}

function isLikelyPageImage(url: string) {
    const normalized = url.toLowerCase();
    if (!/^https?:\/\//.test(normalized)) return false;
    if (!/\.(png|jpe?g|webp|avif|gif)(\?|$)/i.test(normalized)) return false;
    if (/logo|avatar|icon|banner|ads?|thumb|cover/.test(normalized)) return false;
    return true;
}

function extractCssBackgroundImage(styleValue: string | null | undefined) {
    if (!styleValue) return "";
    const match = styleValue.match(/url\((['"]?)(.*?)\1\)/i);
    return match?.[2] ?? "";
}

function extractPinterestMediaUrl(href: string | undefined) {
    if (!href) return "";

    try {
        const parsed = new URL(href, BASE_URL);
        return parsed.searchParams.get("media")?.trim() ?? "";
    } catch {
        return "";
    }
}

function getSeriesCoverUrl($: cheerio.CheerioAPI) {
    const thumbImage = $(
        ".seriestucontl .thumb img[itemprop='image'], .seriestucontl .thumb img, .bigcover .thumb img",
    ).first();

    const backgroundCover = extractCssBackgroundImage(
        $(".bigcover .bigbanner").first().attr("style"),
    );

    const pinterestMedia = extractPinterestMediaUrl(
        $("a.pntrs, a[href*='pinterest.com/pin/create/button/']").first().attr("href"),
    );

    return toAbsoluteUrl(
        thumbImage.attr("data-src")
        || thumbImage.attr("data-lazy-src")
        || thumbImage.attr("src")
        || backgroundCover
        || $("meta[property='og:image']").attr("content")
        || $("meta[name='twitter:image']").attr("content")
        || pinterestMedia
        || $(
            "article img.wp-post-image, article img.ts-post-image, #content .thumb img, #content img.wp-post-image, #content img.ts-post-image",
        ).first().attr("src"),
    );
}

export async function search(
    query: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: SearchOptions,
): Promise<SearchResult[]> {
    const term = normalizeText(query).toLowerCase();

    const urls = [
        `${BASE_URL}/?s=${encodeURIComponent(term)}&post_type=wp-manga`,
        `${BASE_URL}/manga/?order=update`,
    ];

    const results = new Map<string, SearchResult>();

    for (const url of urls) {
        const html = await throttledFetch(url, { referer: `${BASE_URL}/` });
        const $ = cheerio.load(html);

        $("a[href*='/manga/']").each((_, anchor) => {
            const element = $(anchor);
            const slug = parseSeriesSlug(element.attr("href") ?? "");
            if (!slug || results.has(slug)) return;

            const card = element.closest("article, .c-tabs-item__content, .page-item-detail, li, .item");
            const title =
                normalizeText(element.attr("title"))
                || normalizeText(element.find("h3, h4").first().text())
                || normalizeText(card.find(".post-title, h3, h4").first().text())
                || normalizeText(element.text())
                || slug;

            if (term && !title.toLowerCase().includes(term)) {
                return;
            }

            const tags: string[] = [];
            card.find("a[href*='/genres/']").each((_, tagAnchor) => {
                const tag = normalizeText($(tagAnchor).text());
                if (tag && !tags.includes(tag)) {
                    tags.push(tag);
                }
            });

            const status = normalizeStatus(
                card.find(".status, .summary-content, .post-status").first().text() || card.text(),
            );

            results.set(slug, {
                sourceId: slug,
                title,
                slug,
                coverUrl: toAbsoluteUrl(
                    element.find("img.ts-post-image, img.wp-post-image, img").first().attr("data-src")
                    || element.find("img.ts-post-image, img.wp-post-image, img").first().attr("data-lazy-src")
                    || element.find("img.ts-post-image, img.wp-post-image, img").first().attr("src")
                    || card.find("img.ts-post-image, img.wp-post-image, .thumb img, .limit img, img").first().attr("data-src")
                    || card.find("img.ts-post-image, img.wp-post-image, .thumb img, .limit img, img").first().attr("data-lazy-src")
                    || card.find("img.ts-post-image, img.wp-post-image, .thumb img, .limit img, img").first().attr("src"),
                ),
                year: extractYear(card.text()),
                status,
                type: "Manhwa",
                authors: [],
                tags,
                source: "hentai20",
            });
        });

        if (results.size > 0 && term) {
            break;
        }
    }

    return [...results.values()];
}

export async function getSeriesDetail(sourceId: string): Promise<SeriesDetail> {
    const url = `${BASE_URL}/manga/${sourceId}/`;
    const html = await throttledFetch(url, { referer: `${BASE_URL}/` });
    const $ = cheerio.load(html);

    const title =
        normalizeText($(".post-title h1, h1").first().text())
        || normalizeText($("meta[property='og:title']").attr("content"))
        || sourceId;

    const coverUrl = getSeriesCoverUrl($);

    const description =
        normalizeText($(".summary__content .manga-excerpt").first().text())
        || normalizeText($(".summary__content").first().text())
        || normalizeText($("meta[property='og:description']").attr("content"));

    const authors: string[] = [];
    $("a[href*='/manga-author/'], .author-content a").each((_, anchor) => {
        const author = normalizeText($(anchor).text());
        if (author && !authors.includes(author)) {
            authors.push(author);
        }
    });

    const tags: string[] = [];
    $("a[href*='/genres/'], .genres-content a").each((_, anchor) => {
        const tag = normalizeText($(anchor).text());
        if (tag && !tags.includes(tag)) {
            tags.push(tag);
        }
    });

    const fullText = $("body").text();
    const status = normalizeStatus(
        $(".post-status .summary-content, .summary-content").first().text()
        || fullText,
    );

    return {
        sourceId,
        title,
        slug: sourceId,
        coverUrl,
        description,
        authors,
        tags,
        type: "Manhwa",
        status,
        year: extractYear(fullText),
        isAdult: true,
        isOfficial: false,
        anilistUrl: null,
        relatedSeries: [],
    };
}

export async function getChapterList(sourceId: string): Promise<Chapter[]> {
    const ajaxUrl = `${BASE_URL}/manga/${sourceId}/ajax/chapters/`;

    let html = "";
    if (!ajaxChapterEndpointMissing.has(sourceId)) {
        try {
            html = await throttledFetch(
                ajaxUrl,
                {
                    method: "POST",
                    referer: `${BASE_URL}/manga/${sourceId}/`,
                },
                { suppressErrorLog: true },
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            const isMissingAjaxEndpoint = /request failed:\s*404\b/i.test(message);

            if (isMissingAjaxEndpoint) {
                ajaxChapterEndpointMissing.add(sourceId);
            } else {
                logWarn("source.hentai20.ajax_failed_fallback", {
                    sourceId,
                    message,
                });
            }
        }
    }

    if (!html) {
        html = await throttledFetch(`${BASE_URL}/manga/${sourceId}/`, { referer: `${BASE_URL}/` });
    }

    const $ = cheerio.load(html);
    const chapters = new Map<string, Chapter>();

    $("li.wp-manga-chapter a, a[href*='-chapter-']").each((_, anchor) => {
        const element = $(anchor);
        const chapterSlug = parseChapterSlug(element.attr("href") ?? "");
        if (!chapterSlug || chapters.has(chapterSlug)) return;

        const cloned = element.clone();
        cloned.find("time, .chapter-release-date, span.date, i, .chapterdate").remove();

        const title = normalizeText(cloned.text()) || chapterSlug;
        chapters.set(chapterSlug, {
            sourceChapterId: chapterSlug,
            chapterNo: parseChapterNo(title || chapterSlug),
            title,
        });
    });

    return [...chapters.values()].sort((left, right) => {
        if (left.chapterNo !== right.chapterNo) {
            return left.chapterNo - right.chapterNo;
        }
        return left.sourceChapterId.localeCompare(right.sourceChapterId);
    });
}

export async function getChapterPages(chapterSourceId: string): Promise<ChapterPage[]> {
    const chapterUrl = `${BASE_URL}/${chapterSourceId}/`;
    const html = await throttledFetch(chapterUrl, {
        referer: `${BASE_URL}/`,
    });

    const $ = cheerio.load(html);
    const pages = new Set<string>();

    $(".reading-content img, .chapter-content img, .entry-content img, #readerarea img, #readerarea noscript img").each((_, image) => {
        const src =
            $(image).attr("data-src")
            || $(image).attr("data-lazy-src")
            || $(image).attr("src");
        const absolute = toAbsoluteUrl(src);
        if (!absolute || !isLikelyPageImage(absolute)) return;
        pages.add(absolute);
    });

    if (pages.size === 0) {
        const matches = html.match(/https?:\/\/[^"'\s)]+\.(?:png|jpe?g|webp|avif|gif)(?:\?[^"'\s)]*)?/gi) ?? [];
        for (const match of matches) {
            const absolute = toAbsoluteUrl(match);
            if (!absolute || !isLikelyPageImage(absolute)) continue;
            pages.add(absolute);
        }
    }

    if (pages.size === 0) {
        throw new Error(`No chapter pages found for ${chapterSourceId}`);
    }

    return [...pages].map((imageUrl, index) => ({
        index,
        imageUrl,
    }));
}

function getChapterUrl(chapterSourceId: string) {
    return `${BASE_URL}/${chapterSourceId}/`;
}

registerSource({
    name: "hentai20",
    displayName: "Hentai20",
    baseUrl: BASE_URL,
    isNsfw: true,
    getChapterUrl,
    search,
    getSeriesDetail,
    getChapterList,
    getChapterPages,
});
