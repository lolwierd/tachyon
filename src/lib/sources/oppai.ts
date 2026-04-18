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

const BASE_URL = "https://read.oppai.stream";
const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 600;

let lastRequestTime = 0;
let requestQueue: Promise<void> = Promise.resolve();
const responseCache = new Map<string, { expiresAt: number; value: string }>();
const inflightRequests = new Map<string, Promise<string>>();
const imageExtensionCache = new Map<string, string>();

export function clearCache() {
    responseCache.clear();
    inflightRequests.clear();
    imageExtensionCache.clear();
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
                lastError = error instanceof Error ? error : new Error("Unknown Oppai fetch error");

                if (isRetryableError(lastError) && attempt < MAX_RETRIES) {
                    logWarn("source.oppai.retry", {
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

        const finalError = lastError ?? new Error("Unknown Oppai fetch error");
        logError("source.oppai.request_failed", finalError, {
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
        throw new Error(`Oppai request failed: ${res.status} ${res.statusText} — ${url}`);
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

function normalizeText(value: string | null | undefined) {
    return value?.replace(/\s+/g, " ").trim() ?? "";
}

function extractSeriesSlug(href: string) {
    const absolute = toAbsoluteUrl(href);
    if (!absolute) return null;

    try {
        const parsed = new URL(absolute);
        if (!parsed.pathname.startsWith("/manhwa")) {
            return null;
        }
        return parsed.searchParams.get("m")?.trim().toLowerCase() || null;
    } catch {
        return null;
    }
}

function extractSearchTitle(raw: string) {
    const compact = normalizeText(raw);
    if (!compact) return "";

    const afterCover = compact.match(/cover on oppai\.stream\s+(.+)/i)?.[1] ?? compact;
    const withoutTrailingNumbers = afterCover
        .replace(/\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?$/i, "")
        .replace(/\s+\d+(?:\.\d+)?$/i, "")
        .trim();

    return withoutTrailingNumbers || compact;
}

function extractChapterNo(raw: string) {
    const match = raw.match(/(?:chapter|ch\.?|ep\.?|episode)?\s*(\d+(?:\.\d+)?)/i);
    if (!match) return 0;
    const value = Number.parseFloat(match[1] ?? "0");
    return Number.isFinite(value) ? value : 0;
}

function parseChapterSourceId(sourceId: string, chapterSourceId: string) {
    if (chapterSourceId.includes("/")) {
        const [slug, chapter] = chapterSourceId.split("/");
        return { slug: slug || sourceId, chapter: chapter || "" };
    }

    return { slug: sourceId, chapter: chapterSourceId };
}

function isLikelyPageImage(url: string, sourceId: string, chapter: string) {
    const normalized = url.toLowerCase();
    if (!/^https?:\/\//.test(normalized)) return false;
    if (!/\.(png|jpe?g|webp|avif|gif)(\?|$)/i.test(normalized)) return false;
    if (/logo|avatar|icon|banner|ads?/.test(normalized)) return false;

    return (
        normalized.includes(`/manhwa/${sourceId.toLowerCase()}/${chapter.toLowerCase()}/`)
        || normalized.includes("myspacecat.pictures/manhwa/")
    );
}

function extractPageImageUrlsFromHtml(html: string, sourceId: string, chapter: string) {
    const $ = cheerio.load(html);
    const pages = new Set<string>();

    $("img").each((_, image) => {
        const src = $(image).attr("src") || $(image).attr("data-src");
        const absolute = toAbsoluteUrl(src);
        if (!absolute || !isLikelyPageImage(absolute, sourceId, chapter)) return;
        pages.add(absolute);
    });

    if (pages.size === 0) {
        const matches = html.match(/https?:\/\/[^"'\s)]+\.(?:png|jpe?g|webp|avif|gif)(?:\?[^"'\s)]*)?/gi) ?? [];
        for (const match of matches) {
            const absolute = toAbsoluteUrl(match);
            if (!absolute || !isLikelyPageImage(absolute, sourceId, chapter)) continue;
            pages.add(absolute);
        }
    }

    return [...pages];
}

function extractInlineVariable(html: string, variable: string) {
    const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = html.match(new RegExp(
        `var\\s+${escaped}\\s*=\\s*(?:\"([^\"]+)\"|'([^']+)'|([0-9]+(?:\\.[0-9]+)?))\\s*;`,
        "i",
    ));
    const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
    return value.trim();
}

function extractImageHostFromHtml(html: string) {
    const imagesPhpMatch = html.match(/https?:\/\/[^"'\s]+\/manhwa\/images\.php\?f-m=/i)?.[0];
    if (imagesPhpMatch) {
        return imagesPhpMatch.replace(/\/images\.php\?f-m=.*$/i, "").replace(/\/$/, "");
    }

    const hostMatch = html.match(/https?:\/\/[^"'\s]+\/manhwa\//i)?.[0];
    if (hostMatch) {
        return hostMatch.replace(/\/$/, "");
    }

    return null;
}

async function probeImage(url: string, referer: string, method: "HEAD" | "GET") {
    await acquireSlot();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const headers: Record<string, string> = {
            "User-Agent": USER_AGENT,
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "Referer": referer,
        };

        if (method === "GET") {
            headers.Range = "bytes=0-0";
        }

        const response = await fetch(url, {
            method,
            headers,
            redirect: "follow",
            signal: controller.signal,
        });

        return response.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function detectImageExtension(chapterBaseUrl: string, referer: string) {
    const cached = imageExtensionCache.get(chapterBaseUrl);
    if (cached) return cached;

    const extensions = ["jpg", "png", "jpeg", "webp", "avif"];
    for (const extension of extensions) {
        const probeUrl = `${chapterBaseUrl}/1.${extension}`;
        if (await probeImage(probeUrl, referer, "HEAD")) {
            imageExtensionCache.set(chapterBaseUrl, extension);
            return extension;
        }
        if (await probeImage(probeUrl, referer, "GET")) {
            imageExtensionCache.set(chapterBaseUrl, extension);
            return extension;
        }
    }

    return null;
}

async function extractPageImageUrlsFromScript(html: string, sourceId: string, chapter: string) {
    if (!html.includes("images.php") && !html.includes("loadNextImage")) {
        return [];
    }

    const folder = extractInlineVariable(html, "folder") || sourceId;
    const currentChapter = extractInlineVariable(html, "currentChapter") || chapter;
    const imageHost = extractImageHostFromHtml(html);
    if (!imageHost) {
        return [];
    }

    const chapterPageUrl = `${BASE_URL}/page?m=${encodeURIComponent(sourceId)}&c=${encodeURIComponent(chapter)}`;
    const countUrl = `${imageHost}/images.php?f-m=${encodeURIComponent(folder)}&c=${encodeURIComponent(currentChapter)}`;

    let countRaw = "";
    try {
        countRaw = await throttledFetch(countUrl, { referer: chapterPageUrl });
    } catch {
        return [];
    }

    const totalPages = Number.parseInt(countRaw.match(/\d+/)?.[0] ?? "0", 10);
    if (!Number.isFinite(totalPages) || totalPages <= 0) {
        return [];
    }

    const chapterBaseUrl = `${imageHost}/${encodeURIComponent(folder)}/${encodeURIComponent(currentChapter)}`;
    const extension = await detectImageExtension(chapterBaseUrl, chapterPageUrl);
    if (!extension) {
        return [];
    }

    return Array.from({ length: totalPages }, (_, index) => `${chapterBaseUrl}/${index + 1}.${extension}`);
}

export async function search(
    query: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: SearchOptions,
): Promise<SearchResult[]> {
    const term = normalizeText(query).toLowerCase();
    const searchUrls = term
        ? [
            `${BASE_URL}/api-search.php?text=${encodeURIComponent(term)}&order=views&page=1&limit=36&status=all&genres=&blacklist=`,
            `${BASE_URL}/search.php?a=recent`,
        ]
        : [`${BASE_URL}/search.php?a=recent`];

    const results = new Map<string, SearchResult>();

    for (const url of searchUrls) {
        const html = await throttledFetch(url, {
            referer: `${BASE_URL}/`,
        });
        const $ = cheerio.load(html);
        const isRecentFallback = url.includes("search.php?a=recent");

        $("a[href*='/manhwa?m=']").each((_, anchor) => {
            const element = $(anchor);
            const href = element.attr("href") ?? "";
            const slug = extractSeriesSlug(href);
            if (!slug || results.has(slug)) return;

            const title =
                normalizeText(element.find(".man-title").first().text())
                || extractSearchTitle(
                    element.attr("title")
                    || element.find("h3, h4").first().text()
                    || element.text(),
                );

            if (!title) return;
            if (term && isRecentFallback && !title.toLowerCase().includes(term)) return;

            const coverUrl = toAbsoluteUrl(
                element.find("img.read-cover, img").first().attr("src")
                || element.find("img.read-cover, img").first().attr("data-src")
                || element.closest("article, li, .item, .card, .in-grid").find("img.read-cover, img").first().attr("src")
                || element.closest("article, li, .item, .card, .in-grid").find("img.read-cover, img").first().attr("data-src"),
            );

            results.set(slug, {
                sourceId: slug,
                title,
                slug,
                coverUrl,
                year: null,
                status: "",
                type: "Manhwa",
                authors: [],
                tags: [],
                source: "oppai",
            });
        });

        if (term && results.size > 0) {
            break;
        }
    }

    return [...results.values()];
}

export async function getSeriesDetail(sourceId: string): Promise<SeriesDetail> {
    const url = `${BASE_URL}/manhwa?m=${encodeURIComponent(sourceId)}`;
    const html = await throttledFetch(url, { referer: `${BASE_URL}/` });
    const $ = cheerio.load(html);

    const heading =
        normalizeText($("h1").first().text())
        || normalizeText($("meta[property='og:title']").attr("content"))
        || sourceId;

    const authorMatch = heading.match(/\s+By\s+(.+)$/i);
    const title = heading.replace(/\s+By\s+.+$/i, "").trim() || sourceId;
    const authors = authorMatch ? [authorMatch[1]!.trim()] : [];

    const coverUrl = toAbsoluteUrl(
        $("meta[property='og:image']").attr("content")
        || $(`img[src*='/manhwa/${sourceId}/cover']`).first().attr("src")
        || $("img").first().attr("src"),
    );

    const description =
        normalizeText($("meta[property='og:description']").attr("content"))
        || normalizeText($("meta[name='description']").attr("content"))
        || normalizeText($(".description, .synopsis, .summary, p").first().text());

    const bodyText = $("body").text();
    const status = /finished/i.test(bodyText)
        ? "Completed"
        : /updating|ongoing/i.test(bodyText)
            ? "Ongoing"
            : "";

    return {
        sourceId,
        title,
        slug: sourceId,
        coverUrl,
        description,
        authors,
        tags: [],
        type: "Manhwa",
        status,
        year: null,
        isAdult: true,
        isOfficial: false,
        anilistUrl: null,
        relatedSeries: [],
    };
}

export async function getChapterList(sourceId: string): Promise<Chapter[]> {
    const url = `${BASE_URL}/manhwa?m=${encodeURIComponent(sourceId)}`;
    const html = await throttledFetch(url, { referer: `${BASE_URL}/` });
    const $ = cheerio.load(html);

    const chapters = new Map<string, Chapter>();

    // We used to build the CSS selector with the sourceId interpolated
    // directly into the attribute-contains query. That broke on any
    // sourceId containing quotes or brackets, and let an attacker-
    // controlled sourceId produce an arbitrary selector. Just scan
    // all anchors and filter in JS — the CSS engine's job is to
    // narrow, the JS's job is to decide.
    $("a[href*='/page?m=']").each((_, anchor) => {
        const href = $(anchor).attr("href") ?? "";
        const absolute = toAbsoluteUrl(href);
        if (!absolute) return;

        try {
            const parsed = new URL(absolute);
            const chapter = parsed.searchParams.get("c")?.trim() ?? "";
            const slug = parsed.searchParams.get("m")?.trim().toLowerCase() ?? "";
            if (!chapter || !slug || slug !== sourceId.toLowerCase()) return;

            const chapterNo = extractChapterNo(chapter);
            const sourceChapterId = `${slug}/${chapter}`;
            if (chapters.has(sourceChapterId)) return;

            chapters.set(sourceChapterId, {
                sourceChapterId,
                chapterNo,
                title: `Chapter ${chapter}`,
            });
        } catch {
            // ignore malformed chapter links
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
    const [sourceId, chapter] = chapterSourceId.split("/");
    if (!sourceId || !chapter) {
        throw new Error(`Invalid Oppai chapter id: ${chapterSourceId}`);
    }

    const chapterUrls = [
        `${BASE_URL}/infinite-page?m=${encodeURIComponent(sourceId)}&c=${encodeURIComponent(chapter)}`,
        `${BASE_URL}/page?m=${encodeURIComponent(sourceId)}&c=${encodeURIComponent(chapter)}`,
    ];

    for (const url of chapterUrls) {
        try {
            const html = await throttledFetch(url, {
                referer: `${BASE_URL}/manhwa?m=${encodeURIComponent(sourceId)}`,
            });
            const imageUrls = extractPageImageUrlsFromHtml(html, sourceId, chapter);
            if (imageUrls.length > 0) {
                return imageUrls.map((imageUrl, index) => ({
                    index,
                    imageUrl,
                }));
            }

            const scriptImageUrls = await extractPageImageUrlsFromScript(html, sourceId, chapter);
            if (scriptImageUrls.length > 0) {
                return scriptImageUrls.map((imageUrl, index) => ({
                    index,
                    imageUrl,
                }));
            }
        } catch (error) {
            logWarn("source.oppai.chapter_pages_fallback", {
                chapterSourceId,
                url,
                message: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }

    throw new Error(`No chapter pages found for ${chapterSourceId}`);
}

function getChapterUrl(chapterSourceId: string) {
    const { slug, chapter } = parseChapterSourceId("", chapterSourceId);
    return `${BASE_URL}/page?m=${encodeURIComponent(slug)}&c=${encodeURIComponent(chapter)}`;
}

registerSource({
    name: "oppai",
    displayName: "Oppai",
    baseUrl: BASE_URL,
    isNsfw: true,
    getChapterUrl,
    search,
    getSeriesDetail,
    getChapterList,
    getChapterPages,
});
