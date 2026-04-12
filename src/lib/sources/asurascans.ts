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

const BASE_URL = "https://asurascans.com";
const API_URL = "https://api.asurascans.com/api";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = 500;
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

function getCacheKey(url: string, options?: { method?: string; body?: string }) {
  return JSON.stringify({
    url,
    method: options?.method || "GET",
    body: options?.body || "",
  });
}

async function throttledFetch(
  url: string,
  options?: { method?: string; body?: string; accept?: string },
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
        lastError = error instanceof Error ? error : new Error("Unknown AsuraScans fetch error");

        if (isRetryableError(lastError) && attempt < MAX_RETRIES) {
          logWarn("source.asurascans.retry", {
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

    const finalError = lastError ?? new Error("Unknown AsuraScans fetch error");
    logError("source.asurascans.request_failed", finalError, {
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
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS - elapsed));
    }
    lastRequestTime = Date.now();
  });
  requestQueue = slot.catch(() => {});
  return slot;
}

async function fetchWithThrottle(
  url: string,
  options: { method?: string; body?: string; accept?: string } | undefined,
  cacheKey: string,
) {
  await acquireSlot();

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept": options?.accept || "application/json,text/html",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `${BASE_URL}/`,
  };

  if (options?.body) {
    headers["Content-Type"] = "application/json";
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
    throw new Error(
      `AsuraScans request failed: ${res.status} ${res.statusText} — ${url}`,
    );
  }

  const text = await res.text();
  responseCache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: text,
  });
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

// AsuraScans API types

interface AsuraManga {
  id?: number;
  public_url?: string;
  slug: string;
  title: string;
  cover?: string;
  author?: string;
  artist?: string;
  description?: string;
  genres?: { name: string }[];
  status?: string;
  type?: string;
}

interface AsuraMangaDetail {
  series?: AsuraManga;
}

interface AsuraChapter {
  number: number;
  title?: string;
  created_at?: string;
  is_locked?: boolean;
  series_slug?: string;
}

interface AsuraPage {
  url: string;
}

// Helpers

function normalizeStatus(status: string | undefined): string {
  if (!status) return "";
  const lower = status.toLowerCase();
  if (lower.includes("ongoing")) return "Ongoing";
  if (lower.includes("completed") || lower.includes("complete")) return "Complete";
  if (lower.includes("hiatus")) return "Hiatus";
  if (lower.includes("canceled") || lower.includes("cancelled") || lower.includes("dropped")) return "Canceled";
  return status;
}

function buildCoverUrl(cover: string | undefined): string {
  if (!cover) return "";
  if (cover.startsWith("http")) return cover;
  return `${BASE_URL}/${cover.replace(/^\//, "")}`;
}

// search

export async function search(
  query: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: SearchOptions,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams();
    params.set("offset", String(page * 20));
    params.set("limit", "20");
    if (query) params.set("search", query);

    const url = `${API_URL}/series?${params.toString()}`;
    const raw = await throttledFetch(url, { accept: "application/json" });

    let data: AsuraManga[];
    let hasMore = false;
    try {
      const parsed = JSON.parse(raw);
      data = parsed.data ?? (Array.isArray(parsed) ? parsed : []);
      hasMore = parsed.meta?.has_more ?? false;
    } catch {
      logWarn("source.asurascans.search_parse_error", { url });
      break;
    }

    if (!Array.isArray(data) || data.length === 0) break;

    for (const series of data) {
      const slug = series.slug || series.public_url?.replace(/^\/series\//, "") || "";
      if (!slug) continue;

      results.push({
        sourceId: slug,
        title: series.title,
        slug,
        coverUrl: buildCoverUrl(series.cover),
        year: null,
        status: normalizeStatus(series.status),
        type: series.type || "Manhwa",
        authors: [series.author, series.artist].filter((a): a is string => Boolean(a)),
        tags: series.genres?.map((g) => g.name) ?? [],
        source: "asurascans",
      });
    }

    if (!hasMore || data.length < 20) break;
  }

  return results;
}

// getSeriesDetail

export async function getSeriesDetail(
  sourceId: string,
): Promise<SeriesDetail> {
  const url = `${API_URL}/series/${sourceId}`;
  const raw = await throttledFetch(url, { accept: "application/json" });

  let manga: AsuraManga;
  try {
    const parsed = JSON.parse(raw);
    // Handle various response formats:
    // { data: { series: {...} } }  — wrapped detail
    // { data: {...} }              — data wrapper
    // { series: {...} }            — direct series
    // {...}                        — bare manga object
    manga = parsed?.data?.series ?? parsed?.series ?? parsed?.data ?? parsed;
  } catch {
    throw new Error(`Failed to parse series detail for ${sourceId}`);
  }

  const authors: string[] = [];
  if (manga.author) authors.push(manga.author);
  if (manga.artist && manga.artist !== manga.author) authors.push(manga.artist);

  return {
    sourceId,
    title: manga.title || sourceId,
    slug: manga.slug || sourceId,
    coverUrl: buildCoverUrl(manga.cover),
    description: manga.description || "",
    authors,
    tags: manga.genres?.map((g) => g.name) ?? [],
    type: manga.type || "Manhwa",
    status: normalizeStatus(manga.status),
    year: null,
    isAdult: false,
    isOfficial: false,
    anilistUrl: null,
    relatedSeries: [],
  };
}

// getChapterList

export async function getChapterList(
  sourceId: string,
): Promise<Chapter[]> {
  // Fetch the HTML page which contains Astro-embedded chapter data
  const pageUrl = `${BASE_URL}/comics/${sourceId}`;
  const html = await throttledFetch(pageUrl, { accept: "text/html" });
  const $ = cheerio.load(html);

  const chapters: Chapter[] = [];
  const seen = new Set<string>();

  // Try Astro props extraction: look for script with chapter data
  $("script").each((_, el) => {
    const text = $(el).text();
    if (!text.includes("chapters") || !text.includes("number")) return;

    try {
      const parsed = JSON.parse(text);
      // Unwrap Astro array format if needed (arrays wrapped in extra arrays)
      const rawChapters = extractChaptersFromParsed(parsed);
      if (rawChapters.length > 0) {
        for (const ch of rawChapters) {
          addChapter(chapters, seen, ch);
        }
        return false; // break
      }
    } catch { /* not JSON, skip */ }
  });

  // Fallback: look for props attributes on elements
  if (chapters.length === 0) {
    $("[props]").each((_, el) => {
      const propsStr = $(el).attr("props") || "";
      if (!propsStr.includes("chapters")) return;

      try {
        const parsed = JSON.parse(propsStr);
        const rawChapters = extractChaptersFromParsed(parsed);
        for (const ch of rawChapters) {
          addChapter(chapters, seen, ch);
        }
      } catch { /* skip */ }
    });
  }

  // Fallback: API-based chapter list
  if (chapters.length === 0) {
    try {
      const apiUrl = `${API_URL}/series/${sourceId}`;
      const raw = await throttledFetch(apiUrl, { accept: "application/json" });
      const parsed = JSON.parse(raw);
      const chapterList = parsed.data?.chapters ?? parsed.chapters ?? [];
      for (const ch of chapterList) {
        addChapter(chapters, seen, ch);
      }
    } catch {
      logWarn("source.asurascans.chapter_api_fallback_failed", { sourceId });
    }
  }

  return chapters.sort((a, b) => a.chapterNo - b.chapterNo);
}

function extractChaptersFromParsed(parsed: unknown): AsuraChapter[] {
  if (!parsed || typeof parsed !== "object") return [];

  // Direct chapters array
  if (Array.isArray((parsed as Record<string, unknown>).chapters)) {
    return (parsed as { chapters: AsuraChapter[] }).chapters;
  }

  // Nested in data
  const data = (parsed as Record<string, unknown>).data;
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).chapters)) {
    return (data as { chapters: AsuraChapter[] }).chapters;
  }

  // Astro array format: unwrap nested arrays
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (Array.isArray(item)) {
        const found = extractChaptersFromParsed(item[0]);
        if (found.length > 0) return found;
      } else {
        const found = extractChaptersFromParsed(item);
        if (found.length > 0) return found;
      }
    }
  }

  return [];
}

function addChapter(chapters: Chapter[], seen: Set<string>, ch: AsuraChapter) {
  if (ch.is_locked) return;

  const chapterNo = typeof ch.number === "number" ? ch.number : parseFloat(String(ch.number)) || 0;
  const key = `ch-${chapterNo}`;
  if (seen.has(key)) return;
  seen.add(key);

  const title = ch.title
    ? `Chapter ${chapterNo} - ${ch.title}`
    : `Chapter ${chapterNo}`;

  chapters.push({
    sourceChapterId: `${ch.series_slug ?? ""}/${chapterNo}`,
    chapterNo,
    title,
  });
}

// getChapterPages

export async function getChapterPages(
  chapterSourceId: string,
): Promise<ChapterPage[]> {
  // chapterSourceId is "{slug}/{chapterNo}"
  const pageUrl = `${BASE_URL}/comics/${chapterSourceId}`;
  const html = await throttledFetch(pageUrl, { accept: "text/html" });
  const $ = cheerio.load(html);

  const pages: ChapterPage[] = [];

  // Try Astro props extraction for page images
  $("script").each((_, el) => {
    const text = $(el).text();
    if (!text.includes("pages") || !text.includes("url")) return;

    try {
      const parsed = JSON.parse(text);
      const rawPages = extractPagesFromParsed(parsed);
      if (rawPages.length > 0) {
        for (let i = 0; i < rawPages.length; i++) {
          pages.push({ index: i, imageUrl: rawPages[i]!.url });
        }
        return false; // break
      }
    } catch { /* skip */ }
  });

  // Fallback: props attribute
  if (pages.length === 0) {
    $("[props]").each((_, el) => {
      const propsStr = $(el).attr("props") || "";
      if (!propsStr.includes("pages")) return;

      try {
        const parsed = JSON.parse(propsStr);
        const rawPages = extractPagesFromParsed(parsed);
        for (let i = 0; i < rawPages.length; i++) {
          pages.push({ index: i, imageUrl: rawPages[i]!.url });
        }
      } catch { /* skip */ }
    });
  }

  // Fallback: extract images from DOM
  if (pages.length === 0) {
    $("img[alt*='page'], img[data-index], .reading-content img, .chapter-content img").each((_, img) => {
      const src = $(img).attr("src") || $(img).attr("data-src");
      if (src && src.startsWith("http") && /\.(png|jpe?g|webp|avif|gif)/i.test(src)) {
        pages.push({ index: pages.length, imageUrl: src });
      }
    });
  }

  return pages;
}

function extractPagesFromParsed(parsed: unknown): AsuraPage[] {
  if (!parsed || typeof parsed !== "object") return [];

  if (Array.isArray((parsed as Record<string, unknown>).pages)) {
    return (parsed as { pages: AsuraPage[] }).pages.filter((p) => p.url);
  }

  const data = (parsed as Record<string, unknown>).data;
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).pages)) {
    return (data as { pages: AsuraPage[] }).pages.filter((p) => p.url);
  }

  const chapter = (parsed as Record<string, unknown>).chapter;
  if (chapter && typeof chapter === "object" && Array.isArray((chapter as Record<string, unknown>).pages)) {
    return (chapter as { pages: AsuraPage[] }).pages.filter((p) => p.url);
  }

  // Astro array format
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      if (Array.isArray(item)) {
        const found = extractPagesFromParsed(item[0]);
        if (found.length > 0) return found;
      } else {
        const found = extractPagesFromParsed(item);
        if (found.length > 0) return found;
      }
    }
  }

  return [];
}

function getChapterUrl(chapterSourceId: string) {
  return `${BASE_URL}/comics/${chapterSourceId}`;
}

registerSource({
  name: "asurascans",
  displayName: "Asura Scans",
  baseUrl: BASE_URL,
  isNsfw: false,
  getChapterUrl,
  search,
  getSeriesDetail,
  getChapterList,
  getChapterPages,
});
