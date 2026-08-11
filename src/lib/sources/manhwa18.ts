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

const BASE_URL = "https://manhwa18.net";
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
                lastError = error instanceof Error ? error : new Error("Unknown Manhwa18 fetch error");

                if (isRetryableError(lastError) && attempt < MAX_RETRIES) {
                    logWarn("source.manhwa18.retry", {
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

        const finalError = lastError ?? new Error("Unknown Manhwa18 fetch error");
        logError("source.manhwa18.request_failed", finalError, {
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
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
        throw new Error(`Manhwa18 request failed: ${res.status} ${res.statusText} — ${url}`);
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

function normalizeText(value: string | null | undefined) {
    return value?.replace(/\s+/g, " ").trim() ?? "";
}

function toAbsoluteUrl(url: string | null | undefined) {
    if (!url) return "";
    try {
        return new URL(url, BASE_URL).toString();
    } catch {
        return "";
    }
}

function decodeHtmlEntities(raw: string) {
    return raw
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#x2F;/g, "/");
}

function getInertiaPayload(html: string): Record<string, unknown> | null {
    const $ = cheerio.load(html);
    const encodedPayload = $("#app").attr("data-page");
    if (!encodedPayload) {
        return null;
    }

    const candidates = [encodedPayload, decodeHtmlEntities(encodedPayload)];

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate) as unknown;
            if (parsed && typeof parsed === "object") {
                return parsed as Record<string, unknown>;
            }
        } catch {
            // try next decoding strategy
        }
    }

    return null;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown) {
    return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function extractStatus(value: unknown) {
    const normalized = normalizeText(asString(value)).toLowerCase();
    if (!normalized) return "";

    if (normalized.includes("ongoing")) return "Ongoing";
    if (normalized.includes("completed") || normalized.includes("complete")) return "Complete";
    if (normalized.includes("hiatus")) return "Hiatus";
    if (normalized.includes("canceled") || normalized.includes("cancelled")) return "Canceled";

    return normalizeText(asString(value));
}

function extractStatusFromRecord(record: Record<string, unknown>) {
    const statusName = asString(asRecord(record.status).name);
    if (statusName) return extractStatus(statusName);

    const statusRaw = asString(record.status_name) || asString(record.status_text);
    if (statusRaw) return extractStatus(statusRaw);

    const statusId = asNumber(record.status_id);
    if (statusId === 1) return "Ongoing";
    if (statusId === 2) return "Complete";
    if (statusId === 3) return "Hiatus";
    if (statusId === 4) return "Canceled";

    return "";
}

function extractTags(record: Record<string, unknown>) {
    const tags: string[] = [];

    const genres = record.genres;
    if (Array.isArray(genres)) {
        for (const genre of genres) {
            const name = normalizeText(asString(asRecord(genre).name));
            if (name && !tags.includes(name)) {
                tags.push(name);
            }
        }
    }

    return tags;
}

function cleanDescription(value: unknown) {
    const text = asString(value);
    if (!text) return "";

    const stripped = cheerio.load(`<div>${text}</div>`)("div").text();
    return normalizeText(stripped);
}

function parseChapterNo(raw: string) {
    const normalized = raw.toLowerCase();
    const fromLabel = normalized.match(/(?:chap(?:ter)?\.?\s*)(\d+(?:\.\d+)?)/i);
    if (fromLabel) {
        const value = Number.parseFloat(fromLabel[1] ?? "0");
        if (Number.isFinite(value)) return value;
    }

    const fromSlug = normalized.match(/(?:chap(?:ter)?-)(\d+)(?:-(\d+))?/i);
    if (!fromSlug) return 0;

    const main = fromSlug[1] ?? "0";
    const sub = fromSlug[2];
    if (sub) {
        const composite = Number.parseFloat(`${main}.${sub}`);
        return Number.isFinite(composite) ? composite : Number.parseFloat(main) || 0;
    }

    const value = Number.parseFloat(main);
    return Number.isFinite(value) ? value : 0;
}

function isLikelyChapterImage(url: string) {
    const normalized = url.toLowerCase();
    if (!/^https?:\/\//.test(normalized)) return false;
    if (!/\.(png|jpe?g|webp|avif|gif)(\?|$)/i.test(normalized)) return false;
    if (/logo|avatar|icon|banner|ads?|thumb|cover/.test(normalized)) return false;

    return (
        normalized.includes("/chapter")
        || normalized.includes("/manga/")
        || normalized.includes("/uploads/")
        || normalized.includes("/storage/")
    );
}

function isLikelyChapterContentImage(url: string) {
    const normalized = url.toLowerCase();
    if (!/^https?:\/\//.test(normalized)) return false;
    if (!/\.(png|jpe?g|webp|avif|gif)(\?|$)/i.test(normalized)) return false;
    if (/logo|avatar|icon|banner|ads?/.test(normalized)) return false;
    return true;
}

function collectImageUrls(value: unknown, out: Set<string>, depth = 0) {
    if (depth > 8) {
        return;
    }

    if (typeof value === "string") {
        const absolute = toAbsoluteUrl(value);
        if (absolute && isLikelyChapterImage(absolute)) {
            out.add(absolute);
        }
        return;
    }

    if (Array.isArray(value)) {
        for (const entry of value) {
            collectImageUrls(entry, out, depth + 1);
        }
        return;
    }

    if (value && typeof value === "object") {
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            if (key.toLowerCase().includes("password")) continue;
            collectImageUrls(nested, out, depth + 1);
        }
    }
}

function getListItemsFromPayload(payload: Record<string, unknown>) {
    const props = asRecord(payload.props);
    const paginate = asRecord(props.paginate);
    const data = paginate.data;

    return Array.isArray(data)
        ? data.map((item) => asRecord(item))
        : [];
}

function getMangaFromPayload(payload: Record<string, unknown>) {
    return asRecord(asRecord(payload.props).manga);
}

function getChapterEntriesFromManga(manga: Record<string, unknown>) {
    const chapterCollections: unknown[] = [
        manga.chapters,
        manga.chapter,
        manga.chapter_list,
    ];

    const chapters: Record<string, unknown>[] = [];
    for (const chapterCollection of chapterCollections) {
        if (!Array.isArray(chapterCollection)) continue;
        for (const chapter of chapterCollection) {
            chapters.push(asRecord(chapter));
        }
    }

    return chapters;
}

function getChapterEntriesFromPayload(payload: Record<string, unknown>) {
    const props = asRecord(payload.props);
    const manga = getMangaFromPayload(payload);

    const chapterCollections: unknown[] = [
        getChapterEntriesFromManga(manga),
        props.chapters,
        props.chapter,
        props.chapterList,
    ];

    const chapters: Record<string, unknown>[] = [];
    for (const chapterCollection of chapterCollections) {
        if (!Array.isArray(chapterCollection)) continue;
        for (const chapter of chapterCollection) {
            chapters.push(asRecord(chapter));
        }
    }

    return chapters;
}

function extractChapterContentImageUrls(payload: Record<string, unknown>) {
    const props = asRecord(payload.props);
    const chapterContent = asString(props.chapterContent);
    if (!chapterContent) {
        return [];
    }

    const urls = new Set<string>();
    const $ = cheerio.load(chapterContent);

    $("img, amp-img").each((_, image) => {
        const src =
            $(image).attr("data-src")
            || $(image).attr("data-lazy-src")
            || $(image).attr("src")
            || $(image).attr("srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
        const absolute = toAbsoluteUrl(src);
        if (!absolute || !isLikelyChapterContentImage(absolute)) return;
        urls.add(absolute);
    });

    if (urls.size === 0) {
        const matches = chapterContent.match(/(?:https?:)?\/\/[^"'\s)]+\.(?:png|jpe?g|webp|avif|gif)(?:\?[^"'\s)]*)?/gi) ?? [];
        for (const match of matches) {
            const absolute = toAbsoluteUrl(match);
            if (!absolute || !isLikelyChapterContentImage(absolute)) continue;
            urls.add(absolute);
        }
    }

    return [...urls];
}

function matchesSearchTerm(record: Record<string, unknown>, term: string) {
    if (!term) {
        return true;
    }

    const haystacks = [
        asString(record.name),
        asString(record.other_name),
        asString(record.slug),
        asString(record.doujinshi),
        cleanDescription(record.note),
        cleanDescription(record.pilot),
    ];

    return haystacks.some((value) => normalizeText(value).toLowerCase().includes(term));
}

export async function search(
    query: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options?: SearchOptions,
): Promise<SearchResult[]> {
    const term = normalizeText(query).toLowerCase();

    if (term) {
        try {
            const actionSearchPayload = await throttledFetch(
                `${BASE_URL}/action/search?q=${encodeURIComponent(term)}`,
                { referer: `${BASE_URL}/search` },
            );
            const parsed = JSON.parse(actionSearchPayload) as Record<string, unknown>;
            const actionItems = Array.isArray(parsed.data)
                ? parsed.data.map((item) => asRecord(item))
                : [];

            const actionResults: SearchResult[] = [];
            for (const item of actionItems) {
                if (!matchesSearchTerm(item, term)) {
                    continue;
                }

                const slug = normalizeText(asString(item.slug)).toLowerCase();
                const title = normalizeText(asString(item.name));
                if (!slug || !title) {
                    continue;
                }

                actionResults.push({
                    sourceId: slug,
                    title,
                    slug,
                    coverUrl: toAbsoluteUrl(asString(item.cover_url) || asString(item.thumb_url)),
                    year: null,
                    status: "",
                    type: "Manhwa",
                    authors: [],
                    tags: [],
                    source: "manhwa18",
                });
            }

            if (actionResults.length > 0) {
                const deduped = new Map(actionResults.map((item) => [item.sourceId, item]));
                return [...deduped.values()];
            }
        } catch (error) {
            logWarn("source.manhwa18.action_search_failed", {
                query: term,
                message: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }

    const url = `${BASE_URL}/manga-list${term ? `?keyword=${encodeURIComponent(term)}` : "?sort=update"}`;
    const html = await throttledFetch(url, { referer: `${BASE_URL}/` });
    const payload = getInertiaPayload(html);

    const results: SearchResult[] = [];

    if (payload) {
        for (const item of getListItemsFromPayload(payload)) {
            const slug = normalizeText(asString(item.slug)).toLowerCase();
            const title = normalizeText(asString(item.name));
            if (!slug || !title) continue;
            if (!matchesSearchTerm(item, term)) continue;

            results.push({
                sourceId: slug,
                title,
                slug,
                coverUrl: toAbsoluteUrl(asString(item.cover_url) || asString(item.thumb_url)),
                year: asNumber(item.year),
                status: extractStatusFromRecord(item),
                type: normalizeText(asString(item.type)) || "Manhwa",
                authors: [],
                tags: extractTags(item),
                source: "manhwa18",
            });
        }
    }

    if (results.length > 0) {
        const deduped = new Map(results.map((item) => [item.sourceId, item]));
        return [...deduped.values()];
    }

    const $ = cheerio.load(html);
    const fallback = new Map<string, SearchResult>();
    $("a[href*='/manga/']").each((_, anchor) => {
        const href = toAbsoluteUrl($(anchor).attr("href"));
        if (!href) return;

        try {
            const parsed = new URL(href);
            const parts = parsed.pathname.split("/").filter(Boolean);
            if (parts.length < 2 || parts[0] !== "manga") return;
            const slug = normalizeText(parts[1]).toLowerCase();
            if (!slug || fallback.has(slug)) return;

            const title = normalizeText($(anchor).text()) || slug;
            if (term && !title.toLowerCase().includes(term)) return;

            fallback.set(slug, {
                sourceId: slug,
                title,
                slug,
                coverUrl: "",
                year: null,
                status: "",
                type: "Manhwa",
                authors: [],
                tags: [],
                source: "manhwa18",
            });
        } catch {
            // ignore malformed fallback links
        }
    });

    return [...fallback.values()];
}

export async function getSeriesDetail(sourceId: string): Promise<SeriesDetail> {
    const url = `${BASE_URL}/manga/${sourceId}`;
    const html = await throttledFetch(url, { referer: `${BASE_URL}/` });
    const payload = getInertiaPayload(html);

    if (payload) {
        const manga = getMangaFromPayload(payload);
        const title = normalizeText(asString(manga.name)) || sourceId;

        const authors: string[] = [];
        const rawAuthors = manga.authors;
        if (Array.isArray(rawAuthors)) {
            for (const author of rawAuthors) {
                const name = normalizeText(asString(asRecord(author).name));
                if (name && !authors.includes(name)) {
                    authors.push(name);
                }
            }
        }

        const singleAuthor = normalizeText(asString(manga.author));
        if (singleAuthor && !authors.includes(singleAuthor)) {
            authors.push(singleAuthor);
        }

        return {
            sourceId,
            title,
            slug: normalizeText(asString(manga.slug)).toLowerCase() || sourceId,
            coverUrl: toAbsoluteUrl(asString(manga.cover_url)),
            description: cleanDescription(manga.description),
            authors,
            tags: extractTags(manga),
            type: normalizeText(asString(manga.type)) || "Manhwa",
            status: extractStatusFromRecord(manga),
            year: asNumber(manga.year),
            isAdult: true,
            isOfficial: false,
            anilistUrl: null,
            relatedSeries: [],
        };
    }

    const $ = cheerio.load(html);
    return {
        sourceId,
        title: normalizeText($("h1").first().text()) || sourceId,
        slug: sourceId,
        coverUrl: toAbsoluteUrl(
            $("meta[property='og:image']").attr("content")
            || $("img").first().attr("src"),
        ),
        description: normalizeText(
            $("meta[property='og:description']").attr("content")
            || $("meta[name='description']").attr("content"),
        ),
        authors: [],
        tags: [],
        type: "Manhwa",
        status: "",
        year: null,
        isAdult: true,
        isOfficial: false,
        anilistUrl: null,
        relatedSeries: [],
    };
}

export async function getChapterList(sourceId: string): Promise<Chapter[]> {
    const url = `${BASE_URL}/manga/${sourceId}`;
    const html = await throttledFetch(url, { referer: `${BASE_URL}/` });
    const payload = getInertiaPayload(html);

    const chapters = new Map<string, Chapter>();

    if (payload) {
        for (const chapter of getChapterEntriesFromPayload(payload)) {
            const chapterSlug = normalizeText(
                asString(chapter.slug)
                || asString(chapter.chapter_slug)
                || asString(chapter.chapterSlug),
            ).toLowerCase();
            if (!chapterSlug) continue;

            const sourceChapterId = `${sourceId}/${chapterSlug}`;
            if (chapters.has(sourceChapterId)) continue;

            const title = normalizeText(
                asString(chapter.name)
                || asString(chapter.title)
                || asString(chapter.chapter_name)
                || asString(chapter.chapterName),
            ) || `Chapter ${parseChapterNo(chapterSlug)}`;

            // Inertia payload exposes ISO-8601 in createdAt (sometimes with
            // trailing microseconds — Date.parse accepts both).
            const createdAt =
                asString(chapter.createdAt)
                || asString(chapter.created_at)
                || asString(chapter.created);
            const parsedCreated = createdAt ? Date.parse(createdAt) : NaN;
            const publishedAt = Number.isFinite(parsedCreated) ? parsedCreated : null;

            chapters.set(sourceChapterId, {
                sourceChapterId,
                chapterNo: parseChapterNo(title || chapterSlug),
                title,
                publishedAt,
            });
        }
    }

    if (chapters.size === 0) {
        const $ = cheerio.load(html);
        $("a[href*='/manga/']").each((_, anchor) => {
            const href = toAbsoluteUrl($(anchor).attr("href"));
            if (!href) return;

            try {
                const parsed = new URL(href);
                const parts = parsed.pathname.split("/").filter(Boolean);
                if (parts.length < 3 || parts[0] !== "manga") return;

                const slug = normalizeText(parts[1]).toLowerCase();
                const chapterSlug = normalizeText(parts[2]).toLowerCase();
                if (slug !== sourceId.toLowerCase() || !/^(?:chap|chapter)-/.test(chapterSlug)) return;

                const sourceChapterId = `${slug}/${chapterSlug}`;
                if (chapters.has(sourceChapterId)) return;

                const title = normalizeText($(anchor).text()) || `Chapter ${parseChapterNo(chapterSlug)}`;
                chapters.set(sourceChapterId, {
                    sourceChapterId,
                    chapterNo: parseChapterNo(title || chapterSlug),
                    title,
                });
            } catch {
                // ignore malformed links
            }
        });
    }

    return [...chapters.values()].sort((left, right) => {
        if (left.chapterNo !== right.chapterNo) {
            return left.chapterNo - right.chapterNo;
        }
        return left.sourceChapterId.localeCompare(right.sourceChapterId);
    });
}

export async function getChapterPages(chapterSourceId: string): Promise<ChapterPage[]> {
    const [sourceId, chapterSlug] = chapterSourceId.split("/");
    if (!sourceId || !chapterSlug) {
        throw new Error(`Invalid Manhwa18 chapter id: ${chapterSourceId}`);
    }

    const url = `${BASE_URL}/manga/${sourceId}/${chapterSlug}`;
    const html = await throttledFetch(url, {
        referer: `${BASE_URL}/manga/${sourceId}`,
    });

    const imageUrls = new Set<string>();
    const payload = getInertiaPayload(html);

    if (payload) {
        const chapterContentImageUrls = extractChapterContentImageUrls(payload);
        if (chapterContentImageUrls.length > 0) {
            for (const imageUrl of chapterContentImageUrls) {
                imageUrls.add(imageUrl);
            }
        } else {
            collectImageUrls(payload, imageUrls);
        }
    }

    const $ = cheerio.load(html);
    $(".reading-content img, .chapter-content img, .entry-content img, img").each((_, image) => {
        const src =
            $(image).attr("data-src")
            || $(image).attr("data-lazy-src")
            || $(image).attr("src");
        const absolute = toAbsoluteUrl(src);
        if (!absolute || !isLikelyChapterImage(absolute)) return;
        imageUrls.add(absolute);
    });

    if (imageUrls.size === 0) {
        const matches = html.match(/https?:\/\/[^"'\s)]+\.(?:png|jpe?g|webp|avif|gif)(?:\?[^"'\s)]*)?/gi) ?? [];
        for (const match of matches) {
            const absolute = toAbsoluteUrl(match);
            if (!absolute || !isLikelyChapterImage(absolute)) continue;
            imageUrls.add(absolute);
        }
    }

    if (imageUrls.size === 0) {
        throw new Error(`No chapter pages found for ${chapterSourceId}`);
    }

    return [...imageUrls].map((imageUrl, index) => ({
        index,
        imageUrl,
    }));
}

function getSeriesUrl(sourceSeriesId: string) {
    return `${BASE_URL}/manga/${encodeURIComponent(sourceSeriesId)}`;
}

function getChapterUrl(chapterSourceId: string) {
  return `${BASE_URL}/manga/${chapterSourceId}`;
}

registerSource({
    name: "manhwa18",
    displayName: "Manhwa18",
    baseUrl: BASE_URL,
    isNsfw: true,
    getSeriesUrl,
    getChapterUrl,
    search,
    getSeriesDetail,
    getChapterList,
    getChapterPages,
});
