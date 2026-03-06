import type {
  SearchResult,
  SeriesDetail,
  Chapter,
  ChapterPage,
  SearchOptions,
} from "./types";
import { registerSource } from "./registry";
import { logError, logWarn } from "@/lib/server/log";

const BASE_URL = "https://omegascans.org";
const API_URL = "https://api.omegascans.org";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 600;

// Rate-limiting: serial queue with 300ms gap between requests.

let lastRequestTime = 0;
let requestQueue: Promise<void> = Promise.resolve();
const responseCache = new Map<string, { expiresAt: number; value: string }>();
const inflightRequests = new Map<string, Promise<string>>();

export function clearCache() {
  responseCache.clear();
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
  options?: { method?: string; body?: string },
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
        lastError = error instanceof Error ? error : new Error("Unknown OmegaScans fetch error");

        if (isRetryableError(lastError) && attempt < MAX_RETRIES) {
          logWarn("source.omegascans.retry", {
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

    const finalError = lastError ?? new Error("Unknown OmegaScans fetch error");
    logError("source.omegascans.request_failed", finalError, {
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
  requestQueue = slot.catch(() => { });
  return slot;
}

async function fetchWithThrottle(
  url: string,
  options: { method?: string; body?: string } | undefined,
  cacheKey: string,
) {
  await acquireSlot();

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": BASE_URL,
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
      `OmegaScans request failed: ${res.status} ${res.statusText} — ${url}`,
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
    message.includes("429") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("timeout") ||
    message.includes("fetch failed")
  );
}

// HeanCms API types

interface HeanCmsSeries {
  id: number;
  title: string;
  series_slug: string;
  description: string | null;
  thumbnail: string | null;
  status: string | null;
  series_type: string | null;
  adult: boolean;
  created_at: string | null;
  updated_at: string | null;
  author?: string | null;
  authors?: { name: string }[];
  tags?: { name: string }[];
  seasons?: {
    index: number;
    chapters?: HeanCmsChapter[];
  }[];
  related_series?: {
    id: number;
    title: string;
    series_slug: string;
    pivot?: { relation_type: string };
  }[];
}

interface HeanCmsChapter {
  id: number;
  chapter_name: string;
  chapter_title: string | null;
  chapter_slug: string;
  chapter_data?: {
    images?: string[];
  };
  created_at: string | null;
  index?: number;
  price?: number;
}

interface HeanCmsChapterDetail {
  chapter: HeanCmsChapter & { storage?: string; chapter_type?: string };
  data?: string[];
  paywall?: boolean;
}

// Helpers

function buildCoverUrl(thumbnail: string | null): string {
  if (!thumbnail) return "";
  if (thumbnail.startsWith("http")) return thumbnail;
  return `${API_URL}/${thumbnail}`;
}

function parseChapterNo(name: string): number {
  const match = name.match(/(?:Chapter|Ch\.?)\s*([\d.]+)/i);
  return match ? parseFloat(match[1]) : 0;
}

// search

export async function search(
  query: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: SearchOptions,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const perPage = 100;

  // HeanCms /query endpoint — iterate pages until empty
  for (let page = 1; page <= 10; page += 1) {
    const params = new URLSearchParams();
    params.set("perPage", String(perPage));
    params.set("page", String(page));
    params.set("adult", "true");
    if (query) params.set("query_string", query);

    const url = `${API_URL}/query?${params.toString()}`;
    const raw = await throttledFetch(url);
    let data: HeanCmsSeries[];
    try {
      const parsed = JSON.parse(raw);
      data = parsed.data ?? parsed;
    } catch {
      logWarn("source.omegascans.search_parse_error", { url });
      break;
    }

    if (!Array.isArray(data) || data.length === 0) break;

    for (const series of data) {
      if (query && !series.title.toLowerCase().includes(query.toLowerCase())) {
        continue;
      }

      results.push({
        sourceId: series.series_slug,
        title: series.title,
        slug: series.series_slug,
        coverUrl: buildCoverUrl(series.thumbnail),
        year: series.created_at ? new Date(series.created_at).getFullYear() : null,
        status: series.status || "",
        type: series.series_type || "Comic",
        authors: series.authors?.map((a) => a.name) ?? (series.author ? [series.author] : []),
        tags: series.tags?.map((t) => t.name) ?? [],
        source: "omegascans",
      });
    }

    if (data.length < perPage) break;
  }

  return results;
}

// getSeriesDetail

export async function getSeriesDetail(
  sourceId: string,
): Promise<SeriesDetail> {
  // sourceId is stored as the slug for detail lookups
  const url = `${API_URL}/series/${sourceId}`;
  const raw = await throttledFetch(url);
  const series: HeanCmsSeries = JSON.parse(raw);

  return {
    sourceId: series.series_slug,
    title: series.title,
    slug: series.series_slug,
    coverUrl: buildCoverUrl(series.thumbnail),
    description: series.description || "",
    authors: series.authors?.map((a) => a.name) ?? (series.author ? [series.author] : []),
    tags: series.tags?.map((t) => t.name) ?? [],
    type: series.series_type || "Comic",
    status: series.status || "",
    year: series.created_at ? new Date(series.created_at).getFullYear() : null,
    isAdult: true,
    isOfficial: false,
    anilistUrl: null,
    relatedSeries: (series.related_series ?? []).map((r) => ({
      sourceId: r.series_slug,
      title: r.title,
      relationship: r.pivot?.relation_type || "Related",
    })),
  };
}

// getChapterList

export async function getChapterList(
  sourceId: string,
): Promise<Chapter[]> {
  // Try V1 (seasons from series endpoint) first, then fall back to V2
  const seriesUrl = `${API_URL}/series/${sourceId}`;
  const raw = await throttledFetch(seriesUrl);
  const series: HeanCmsSeries = JSON.parse(raw);

  const chapters: Chapter[] = [];

  if (series.seasons && series.seasons.length > 0) {
    for (const season of series.seasons) {
      for (const ch of (season.chapters ?? [])) {
        chapters.push({
          sourceChapterId: `${series.series_slug}/${ch.chapter_slug}`,
          chapterNo: parseChapterNo(ch.chapter_name),
          title: `${ch.chapter_name}${ch.chapter_title ? ` ${ch.chapter_title}` : ""}`.trim(),
        });
      }
    }
  }

  // Fall back to V2 chapter/query endpoint if V1 yielded nothing
  if (chapters.length === 0) {
    // V2: chapter/query endpoint
    const queryUrl = `${API_URL}/chapter/query?series_id=${series.id}&perPage=9999&page=1`;
    const chRaw = await throttledFetch(queryUrl);
    let chData: HeanCmsChapter[] = [];
    try {
      const parsed = JSON.parse(chRaw);
      chData = Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }

    for (const ch of chData) {
      chapters.push({
        sourceChapterId: `${series.series_slug}/${ch.chapter_slug}`,
        chapterNo: parseChapterNo(ch.chapter_name),
        title: `${ch.chapter_name}${ch.chapter_title ? ` ${ch.chapter_title}` : ""}`.trim(),
      });
    }
  }

  return chapters;
}

// getChapterPages

export async function getChapterPages(
  chapterSourceId: string,
): Promise<ChapterPage[]> {
  // chapterSourceId is "{seriesSlug}/{chapterSlug}"
  const url = `${API_URL}/chapter/${chapterSourceId}`;
  const raw = await throttledFetch(url);
  const data: HeanCmsChapterDetail = JSON.parse(raw);

  if (data.paywall) {
    throw new Error(`Chapter is paywalled: ${chapterSourceId}`);
  }

  const images = data.data ?? data.chapter?.chapter_data?.images ?? [];
  const storage = data.chapter?.storage;

  return images.map((image, index) => {
    let imageUrl: string;
    if (storage === "s3" || image.startsWith("http")) {
      imageUrl = image;
    } else {
      imageUrl = `${API_URL}/${image}`;
    }

    return { index, imageUrl };
  });
}

registerSource({
  name: "omegascans",
  displayName: "OmegaScans",
  baseUrl: BASE_URL,
  isNsfw: true,
  search,
  getSeriesDetail,
  getChapterList,
  getChapterPages,
});
