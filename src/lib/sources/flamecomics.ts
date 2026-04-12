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

const BASE_URL = "https://flamecomics.xyz";
const CDN_URL = "https://cdn.flamecomics.xyz";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = 500; // Throttle between requests (server-side is less aggressive)
const REQUEST_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

let lastRequestTime = 0;
let requestQueue: Promise<void> = Promise.resolve();
const responseCache = new Map<string, { expiresAt: number; value: string }>();
const inflightRequests = new Map<string, Promise<string>>();

// BuildId management for Next.js data API
let cachedBuildId: string | null = null;
let buildIdExpiresAt = 0;
const BUILD_ID_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function clearCache() {
  responseCache.clear();
  inflightRequests.clear();
  lastRequestTime = 0;
  requestQueue = Promise.resolve();
  cachedBuildId = null;
  buildIdExpiresAt = 0;
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
        lastError = error instanceof Error ? error : new Error("Unknown FlameComics fetch error");

        if (isRetryableError(lastError) && attempt < MAX_RETRIES) {
          logWarn("source.flamecomics.retry", {
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

    const finalError = lastError ?? new Error("Unknown FlameComics fetch error");
    logError("source.flamecomics.request_failed", finalError, {
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
    "Accept": options?.accept || "text/html,application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `${BASE_URL}/`,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const res = await fetch(url, {
    method: options?.method || "GET",
    headers,
    redirect: "follow",
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeoutId);
  });

  if (!res.ok) {
    throw new Error(
      `FlameComics request failed: ${res.status} ${res.statusText} — ${url}`,
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

// Next.js buildId management

export async function fetchBuildId(): Promise<string> {
  if (cachedBuildId && buildIdExpiresAt > Date.now()) {
    return cachedBuildId;
  }

  const html = await throttledFetch(BASE_URL, { accept: "text/html" });
  const $ = cheerio.load(html);

  const nextDataScript = $("#__NEXT_DATA__").text();
  if (nextDataScript) {
    try {
      const nextData = JSON.parse(nextDataScript);
      if (nextData.buildId) {
        cachedBuildId = nextData.buildId;
        buildIdExpiresAt = Date.now() + BUILD_ID_TTL_MS;
        return cachedBuildId;
      }
    } catch { /* fallback below */ }
  }

  // Fallback: look for buildId in script src attributes
  $("script[src*='/_next/static/']").each((_, el) => {
    const src = $(el).attr("src") || "";
    const match = src.match(/\/_next\/static\/([^/]+)\//);
    if (match?.[1] && match[1] !== "chunks" && match[1] !== "css") {
      cachedBuildId = match[1];
      buildIdExpiresAt = Date.now() + BUILD_ID_TTL_MS;
      return false; // break
    }
  });

  if (!cachedBuildId) {
    throw new Error("FlameComics: unable to extract Next.js buildId");
  }

  return cachedBuildId;
}

async function fetchNextData(path: string, queryParams?: Record<string, string>): Promise<unknown> {
  const buildId = await fetchBuildId();
  let url = `${BASE_URL}/_next/data/${buildId}/${path}.json`;

  if (queryParams) {
    const params = new URLSearchParams(queryParams);
    url += `?${params.toString()}`;
  }

  try {
    const raw = await throttledFetch(url, { accept: "application/json" });
    return JSON.parse(raw);
  } catch (error) {
    // On 404, refresh buildId and retry once
    if (error instanceof Error && error.message.includes("404")) {
      cachedBuildId = null;
      buildIdExpiresAt = 0;
      // Clear cached homepage response so fetchBuildId gets a fresh one
      for (const key of responseCache.keys()) {
        if (key.includes(BASE_URL) && !key.includes("/_next/data/")) {
          responseCache.delete(key);
        }
      }
      const newBuildId = await fetchBuildId();
      let retryUrl = `${BASE_URL}/_next/data/${newBuildId}/${path}.json`;
      if (queryParams) {
        retryUrl += `?${new URLSearchParams(queryParams).toString()}`;
      }
      const raw = await throttledFetch(retryUrl, { accept: "application/json" });
      return JSON.parse(raw);
    }
    throw error;
  }
}

// FlameComics API types

interface FlameSeries {
  series_id: number;
  title: string;
  altTitles?: string;
  cover?: string;
  last_edit?: number;
  views?: number;
  type?: string;
  description?: string;
  tags?: string[];
  author?: string;
  artist?: string;
  status?: string;
}

interface FlameChapter {
  chapter: number;
  title?: string;
  release_date?: number;
  token: string;
  series_id?: number;
}

interface FlamePageImage {
  name: string;
}

// Helpers

function normalizeStatus(status: string | undefined): string {
  if (!status) return "";
  const lower = status.toLowerCase();
  if (lower.includes("ongoing")) return "Ongoing";
  if (lower.includes("completed") || lower.includes("complete")) return "Complete";
  if (lower.includes("hiatus")) return "Hiatus";
  if (lower.includes("dropped") || lower.includes("canceled") || lower.includes("cancelled")) return "Canceled";
  return status;
}

function buildCoverUrl(seriesId: number, cover: string | undefined): string {
  if (!cover) return "";
  if (cover.startsWith("http")) return cover;
  return `${CDN_URL}/uploads/images/series/${seriesId}/${cover}`;
}

function buildPageImageUrl(seriesId: number, filename: string, releaseDate?: number): string {
  let url = `${CDN_URL}/uploads/images/series/${seriesId}/${filename}`;
  if (releaseDate) {
    url += `?${releaseDate}`;
  }
  return url;
}

function normalizeQuery(query: string): string {
  return query.replace(/[^A-Za-z0-9 ]/g, "").toLowerCase().trim();
}

// search

export async function search(
  query: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: SearchOptions,
): Promise<SearchResult[]> {
  const data = await fetchNextData("browse", undefined) as {
    pageProps?: { data?: FlameSeries[] };
  };

  const allSeries = data?.pageProps?.data ?? [];
  const normalizedQuery = normalizeQuery(query);

  const filtered = normalizedQuery
    ? allSeries.filter((s) => {
      const titleMatch = normalizeQuery(s.title).includes(normalizedQuery);
      const altMatch = s.altTitles
        ? normalizeQuery(s.altTitles).includes(normalizedQuery)
        : false;
      return titleMatch || altMatch;
    })
    : allSeries;

  return filtered.map((series) => ({
    sourceId: String(series.series_id),
    title: series.title,
    slug: String(series.series_id),
    coverUrl: buildCoverUrl(series.series_id, series.cover),
    year: null,
    status: normalizeStatus(series.status),
    type: series.type || "Manhwa",
    authors: [series.author, series.artist].filter((a): a is string => Boolean(a)),
    tags: series.tags ?? [],
    source: "flamecomics",
  }));
}

// getSeriesDetail

export async function getSeriesDetail(
  sourceId: string,
): Promise<SeriesDetail> {
  const data = await fetchNextData(`series/${sourceId}`, { id: sourceId }) as {
    pageProps?: { data?: FlameSeries; chapters?: FlameChapter[] };
  };

  const series = data?.pageProps?.data;
  if (!series) {
    throw new Error(`FlameComics: series not found: ${sourceId}`);
  }

  const authors: string[] = [];
  if (series.author) authors.push(series.author);
  if (series.artist && series.artist !== series.author) authors.push(series.artist);

  // Strip HTML from description
  const description = series.description
    ? cheerio.load(series.description).text().trim()
    : "";

  return {
    sourceId,
    title: series.title,
    slug: String(series.series_id),
    coverUrl: buildCoverUrl(series.series_id, series.cover),
    description,
    authors,
    tags: series.tags ?? [],
    type: series.type || "Manhwa",
    status: normalizeStatus(series.status),
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
  const data = await fetchNextData(`series/${sourceId}`, { id: sourceId }) as {
    pageProps?: { chapters?: FlameChapter[] };
  };

  const rawChapters = data?.pageProps?.chapters ?? [];

  return rawChapters.map((ch) => ({
    sourceChapterId: `${sourceId}/${ch.token}`,
    chapterNo: typeof ch.chapter === "number" ? ch.chapter : parseFloat(String(ch.chapter)) || 0,
    title: ch.title
      ? `Chapter ${ch.chapter} - ${ch.title}`
      : `Chapter ${ch.chapter}`,
  })).sort((a, b) => a.chapterNo - b.chapterNo);
}

// getChapterPages

export async function getChapterPages(
  chapterSourceId: string,
): Promise<ChapterPage[]> {
  // chapterSourceId is "{seriesId}/{token}"
  const parts = chapterSourceId.split("/");
  const seriesId = parts[0]!;
  const token = parts[1]!;

  const data = await fetchNextData(`series/${seriesId}/${token}`, {
    id: seriesId,
    token,
  }) as {
    pageProps?: {
      images?: FlamePageImage[];
      release_date?: number;
      data?: { images?: FlamePageImage[]; release_date?: number };
    };
  };

  const pageProps = data?.pageProps;
  const images = pageProps?.images ?? pageProps?.data?.images ?? [];
  const releaseDate = pageProps?.release_date ?? pageProps?.data?.release_date;
  const numericSeriesId = parseInt(seriesId, 10);

  return images.map((img, index) => ({
    index,
    imageUrl: buildPageImageUrl(numericSeriesId, img.name, releaseDate),
  }));
}

function getChapterUrl(chapterSourceId: string) {
  const parts = chapterSourceId.split("/");
  return `${BASE_URL}/series/${parts[0]}/${parts[1]}`;
}

registerSource({
  name: "flamecomics",
  displayName: "Flame Comics",
  baseUrl: BASE_URL,
  isNsfw: false,
  getChapterUrl,
  search,
  getSeriesDetail,
  getChapterList,
  getChapterPages,
});
