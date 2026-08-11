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
import { parseDateLoose } from "./relative-date";

const BASE_URL = "https://toonily.me";
const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 600;

const RESERVED_PATH_SEGMENTS = new Set([
    "",
    "search",
    "latest",
    "newest",
    "popular",
    "genres",
    "genre",
    "status",
    "top",
    "users",
    "contact",
    "az-list",
    "page",
    "videos",
    "video",
    "ranking",
    "history",
    "login",
    "register",
    "privacy-policy",
    "terms",
]);

let lastRequestTime = 0;
let requestQueue: Promise<void> = Promise.resolve();
const responseCache = new Map<string, { expiresAt: number; value: string }>();
const inflightRequests = new Map<string, Promise<string>>();

export function clearCache() {
    responseCache.clear();
    inflightRequests.clear();
    lastRequestTime = 0;
    requestQueue = Promise.resolve();
}

function getCacheKey(url: string, options?: { method?: string; body?: string; referer?: string }) {
    return JSON.stringify({
        url,
        method: options?.method || "GET",
        body: options?.body || "",
        referer: options?.referer || "",
    });
}

async function throttledFetch(
    url: string,
    options?: { method?: string; body?: string; referer?: string },
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
                lastError = error instanceof Error ? error : new Error("Unknown Toonily fetch error");

                if (isRetryableError(lastError) && attempt < MAX_RETRIES) {
                    logWarn("source.toonily.retry", {
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

        const finalError = lastError ?? new Error("Unknown Toonily fetch error");
        logError("source.toonily.request_failed", finalError, {
            url,
            method: options?.method || "GET",
        });
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
            await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS - elapsed));
        }
        lastRequestTime = Date.now();
    });

    requestQueue = slot.catch(() => { });
    return slot;
}

async function fetchWithThrottle(
    url: string,
    options: { method?: string; body?: string; referer?: string } | undefined,
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
        throw new Error(`Toonily request failed: ${res.status} ${res.statusText} — ${url}`);
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

function extractSeriesSlug(href: string) {
    const absolute = toAbsoluteUrl(href);
    if (!absolute) return null;

    try {
        const parsed = new URL(absolute);
        if (parsed.host !== new URL(BASE_URL).host) {
            return null;
        }

        const segments = parsed.pathname
            .split("/")
            .map((segment) => segment.trim())
            .filter(Boolean);

        if (segments.length !== 1) {
            return null;
        }

        const slug = segments[0]!.toLowerCase();
        if (RESERVED_PATH_SEGMENTS.has(slug)) {
            return null;
        }

        if (slug.startsWith("chapter-") || slug.startsWith("wp-")) {
            return null;
        }

        return slug;
    } catch {
        return null;
    }
}

function parseChapterNoFromSlug(chapterSlug: string): number {
    const match = chapterSlug.match(/chapter-(\d+(?:-\d+)?(?:\.\d+)?)/i);
    if (!match) return 0;

    const raw = match[1] ?? "";
    if (!raw) return 0;

    if (raw.includes("-") && !raw.includes(".")) {
        const [major, minor] = raw.split("-");
        if (major && minor && /^\d+$/.test(major) && /^\d+$/.test(minor)) {
            return Number.parseFloat(`${major}.${minor}`);
        }
    }

    const numeric = Number.parseFloat(raw);
    return Number.isFinite(numeric) ? numeric : 0;
}

function extractChapterInfo(href: string, expectedSeriesSlug?: string) {
    const absolute = toAbsoluteUrl(href);
    if (!absolute) return null;

    try {
        const parsed = new URL(absolute);
        if (parsed.host !== new URL(BASE_URL).host) return null;

        const segments = parsed.pathname
            .split("/")
            .map((segment) => segment.trim())
            .filter(Boolean);

        if (segments.length !== 2) {
            return null;
        }

        const seriesSlug = segments[0]!.toLowerCase();
        const chapterSlug = segments[1]!.toLowerCase();

        if (expectedSeriesSlug && seriesSlug !== expectedSeriesSlug.toLowerCase()) {
            return null;
        }

        if (!chapterSlug.startsWith("chapter-")) {
            return null;
        }

        return {
            sourceChapterId: `${seriesSlug}/${chapterSlug}`,
            chapterNo: parseChapterNoFromSlug(chapterSlug),
            chapterSlug,
        };
    } catch {
        return null;
    }
}

function normalizeText(value: string | null | undefined) {
    return value?.replace(/\s+/g, " ").trim() ?? "";
}

function normalizeStatus(value: string | null | undefined) {
    const text = normalizeText(value).toLowerCase();
    if (!text) return "";

    if (text.includes("ongoing")) return "Ongoing";
    if (text.includes("completed") || text.includes("complete")) return "Complete";
    if (text.includes("hiatus")) return "Hiatus";
    if (text.includes("canceled") || text.includes("cancelled")) return "Canceled";

    return normalizeText(value);
}

function extractYear(text: string) {
    const match = text.match(/(?:released|year)\s*:?\s*(\d{4})/i);
    return match ? Number.parseInt(match[1]!, 10) : null;
}

function dedupe<T extends { sourceId?: string; sourceChapterId?: string }>(items: T[]) {
    const seen = new Set<string>();
    const deduped: T[] = [];

    for (const item of items) {
        const key = item.sourceId ?? item.sourceChapterId;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
    }

    return deduped;
}

function isLikelyReaderImage(url: string) {
    const normalized = url.toLowerCase();
    if (!/^https?:\/\//.test(normalized)) return false;
    if (!/\.(png|jpe?g|webp|avif|gif)(\?|$)/i.test(normalized)) return false;
    if (/logo|avatar|icon|banner|ads?|thumb|cover/.test(normalized)) return false;
    return (
        normalized.includes("toonilycdn")
        || normalized.includes("toonily")
        || normalized.includes("\/uploads\/")
        || normalized.includes("\/wp-content\/")
    );
}

export async function search(
    query: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: SearchOptions,
): Promise<SearchResult[]> {
    const term = normalizeText(query).toLowerCase();

    if (term) {
        try {
            const apiHtml = await throttledFetch(
                `${BASE_URL}/api/manga/search?q=${encodeURIComponent(term)}`,
                { referer: `${BASE_URL}/search?q=${encodeURIComponent(term)}` },
            );
            const $api = cheerio.load(apiHtml);

            const quickResults: SearchResult[] = [];
            $api(".novel__item").each((_, item) => {
                const element = $api(item);
                const link = element.find(".novel__item-icon a, .name h3 a").first();
                const slug = extractSeriesSlug(link.attr("href") ?? "");
                if (!slug) return;

                const title =
                    normalizeText(element.find(".name h3 a").first().text())
                    || normalizeText(link.attr("title"))
                    || slug;

                quickResults.push({
                    sourceId: slug,
                    title,
                    slug,
                    coverUrl: toAbsoluteUrl(
                        element.find("img").first().attr("data-src")
                        || element.find("img").first().attr("data-lazy-src")
                        || element.find("img").first().attr("src"),
                    ),
                    year: null,
                    status: "",
                    type: "Manhwa",
                    authors: [],
                    tags: [],
                    source: "toonily",
                });
            });

            const dedupedQuickResults = dedupe(quickResults);
            if (dedupedQuickResults.length > 0) {
                return dedupedQuickResults;
            }
        } catch (error) {
            logWarn("source.toonily.api_search_failed", {
                query: term,
                message: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }

    const urls = [
        `${BASE_URL}/search${term ? `?q=${encodeURIComponent(term)}` : ""}`,
        `${BASE_URL}/latest`,
    ];

    const results: SearchResult[] = [];

    for (const url of urls) {
        const html = await throttledFetch(url, { referer: `${BASE_URL}/` });
        const $ = cheerio.load(html);

        const localResults: SearchResult[] = [];

        $("a[href]").each((_, anchor) => {
            const element = $(anchor);
            const href = element.attr("href") ?? "";
            const slug = extractSeriesSlug(href);
            if (!slug) return;

            const card = element.closest("article, .page-item-detail, .bs, li, .item, .post");
            const rawTitle =
                normalizeText(element.attr("title"))
                || normalizeText(element.find("h3, h4").first().text())
                || normalizeText(card.find("h3, h4, .tt, .post-title a").first().text())
                || normalizeText(element.text());

            const title = rawTitle.replace(/\s*chapter\s*\d+(?:[.-]\d+)?$/i, "").trim();
            if (!title) return;
            if (term && !title.toLowerCase().includes(term)) return;

            const coverUrl = toAbsoluteUrl(
                element.find("img").first().attr("data-src")
                || element.find("img").first().attr("data-lazy-src")
                || element.find("img").first().attr("src")
                || card.find("img").first().attr("data-src")
                || card.find("img").first().attr("data-lazy-src")
                || card.find("img").first().attr("src"),
            );

            const tags: string[] = [];
            card.find('a[href*="/genres/"]').each((_, tagEl) => {
                const tag = normalizeText($(tagEl).text());
                if (tag && !tags.includes(tag)) {
                    tags.push(tag);
                }
            });

            const status = normalizeStatus(
                card.find('a[href*="/status/"]').first().text() || card.text(),
            );

            localResults.push({
                sourceId: slug,
                title,
                slug,
                coverUrl,
                year: extractYear(card.text()),
                status,
                type: "Manhwa",
                authors: [],
                tags,
                source: "toonily",
            });
        });

        results.push(...dedupe(localResults));

        if (term && results.length > 0) {
            break;
        }
    }

    return dedupe(results);
}

export async function getSeriesDetail(sourceId: string): Promise<SeriesDetail> {
    const url = `${BASE_URL}/${sourceId}`;
    const html = await throttledFetch(url, { referer: `${BASE_URL}/` });
    const $ = cheerio.load(html);

    const title =
        normalizeText($("h1").first().text())
        || normalizeText($("meta[property='og:title']").attr("content"))
        || sourceId;

    const coverUrl = toAbsoluteUrl(
        $("meta[property='og:image']").attr("content")
        || $(".summary_image img").first().attr("data-src")
        || $(".summary_image img").first().attr("src")
        || $("img").first().attr("data-src")
        || $("img").first().attr("src"),
    );

    const description =
        normalizeText($(".summary__content .manga-excerpt").first().text())
        || normalizeText($(".summary__content").first().text())
        || normalizeText($("meta[property='og:description']").attr("content"));

    const authors: string[] = [];
    $("a[href*='/authors/']").each((_, anchor) => {
        const author = normalizeText($(anchor).text());
        if (author && !authors.includes(author)) {
            authors.push(author);
        }
    });

    const tags: string[] = [];
    $("a[href*='/genres/']").each((_, anchor) => {
        const tag = normalizeText($(anchor).text());
        if (tag && !tags.includes(tag)) {
            tags.push(tag);
        }
    });

    const fullText = $("body").text();
    const status = normalizeStatus(
        $("a[href*='/status/']").first().text()
        || $(".post-status .summary-content").first().text()
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
    const url = `${BASE_URL}/${sourceId}`;
    const html = await throttledFetch(url, { referer: `${BASE_URL}/` });
    const $ = cheerio.load(html);

    const chapters = new Map<string, Chapter>();

    $("a[href]").each((_, anchor) => {
        const element = $(anchor);
        const href = element.attr("href") ?? "";
        const parsed = extractChapterInfo(href, sourceId);
        if (!parsed) return;

        if (element.hasClass("btn") || element.text().trim().toUpperCase() === "READ") {
            return;
        }

        // Grab date before stripping — Toonily's Madara rows expose either
        // .chapter-release-date (absolute "Mar 5, 2024") or an `<a title="…">`
        // / `<img alt="…">` with a relative phrase like "2 days ago".
        const container = element.closest("li").length ? element.closest("li") : element;
        const relativeAlt = container.find(".chapter-release-date img").attr("alt");
        const relativeTitle = container.find(".chapter-release-date a").attr("title");
        const absolute = container.find(".chapter-release-date").last().text().trim();
        const publishedAt =
            parseDateLoose(relativeAlt)
            ?? parseDateLoose(relativeTitle)
            ?? parseDateLoose(absolute);

        const cloned = element.clone();
        cloned.find("time, .chapter-update, .chapter-release-date, span.date, i").remove();

        const title = normalizeText(cloned.text()) || `Chapter ${parsed.chapterNo || "?"}`;
        if (!chapters.has(parsed.sourceChapterId)) {
            chapters.set(parsed.sourceChapterId, {
                sourceChapterId: parsed.sourceChapterId,
                chapterNo: parsed.chapterNo,
                title,
                publishedAt,
            });
        }
    });

    return [...chapters.values()].sort((left, right) => {
        if (left.chapterNo !== right.chapterNo) {
            return left.chapterNo - right.chapterNo;
        }
        return left.sourceChapterId.localeCompare(right.sourceChapterId);
    });
}

export async function getChapterPages(chapterSourceId: string): Promise<ChapterPage[]> {
    const chapterUrl = `${BASE_URL}/${chapterSourceId}`;
    const html = await throttledFetch(chapterUrl, {
        referer: `${BASE_URL}/${chapterSourceId.split("/")[0] ?? ""}`,
    });
    const $ = cheerio.load(html);

    const pageUrls = new Set<string>();

    $(".reading-content img, .chapter-content img, .entry-content img, img").each((_, image) => {
        const sourceUrl =
            $(image).attr("data-src")
            || $(image).attr("data-lazy-src")
            || $(image).attr("src");
        const absolute = toAbsoluteUrl(sourceUrl);
        if (!absolute || !isLikelyReaderImage(absolute)) return;
        pageUrls.add(absolute);
    });

    if (pageUrls.size === 0) {
        const fallbackMatches = html.match(/https?:\/\/[^"'\s)]+\.(?:png|jpe?g|webp|avif|gif)(?:\?[^"'\s)]*)?/gi) ?? [];
        for (const match of fallbackMatches) {
            const absolute = toAbsoluteUrl(match);
            if (!absolute || !isLikelyReaderImage(absolute)) continue;
            pageUrls.add(absolute);
        }
    }

    return [...pageUrls].map((imageUrl, index) => ({
        index,
        imageUrl,
    }));
}

function getSeriesUrl(sourceSeriesId: string) {
    return `${BASE_URL}/${encodeURIComponent(sourceSeriesId)}`;
}

function getChapterUrl(chapterSourceId: string) {
  return `${BASE_URL}/${chapterSourceId}`;
}

registerSource({
    name: "toonily",
    displayName: "Toonily",
    baseUrl: BASE_URL,
    isNsfw: true,
    getSeriesUrl,
    getChapterUrl,
    search,
    getSeriesDetail,
    getChapterList,
    getChapterPages,
});
