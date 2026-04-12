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

const BASE_URL = "https://comick.live";
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
        lastError = error instanceof Error ? error : new Error("Unknown ComicK fetch error");

        if (isRetryableError(lastError) && attempt < MAX_RETRIES) {
          logWarn("source.comick.retry", {
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

    const finalError = lastError ?? new Error("Unknown ComicK fetch error");
    logError("source.comick.request_failed", finalError, {
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
      `ComicK request failed: ${res.status} ${res.statusText} — ${url}`,
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

// ComicK API types

interface ComickSearchResult {
  slug: string;
  title: string;
  default_thumbnail?: string;
  thumbnail?: string;
  content_rating?: string;
  country?: string;
  status?: number;
  genres?: { name: string; slug: string }[];
  md_comic_md_genres?: { md_genres: { name: string; slug: string } }[];
}

interface ComickComicData {
  title: string;
  slug: string;
  default_thumbnail?: string;
  thumbnail?: string;
  status?: number;
  translation_completed?: boolean;
  artists?: { name: string }[];
  authors?: { name: string }[];
  desc?: string;
  description?: string;
  content_rating?: string;
  country?: string;
  md_comic_md_genres?: { md_genres: { name: string; slug: string } }[];
  genres?: { name: string; slug: string }[];
  md_titles?: { title: string }[];
}

interface ComickChapter {
  hid: string;
  chap: string;
  vol?: string;
  lang: string;
  title?: string;
  created_at?: string;
  group_name?: string[];
}

interface ComickChapterListResponse {
  data?: ComickChapter[];
  chapters?: ComickChapter[];
  pagination?: {
    current_page?: number;
    last_page?: number;
  };
  total?: number;
}

interface ComickChapterPage {
  url: string;
}

interface ComickPageListData {
  chapter?: {
    images?: ComickChapterPage[];
  };
}

// Helpers

function mapStatus(status: number | undefined): string {
  switch (status) {
    case 1: return "Ongoing";
    case 2: return "Complete";
    case 3: return "Canceled";
    case 4: return "Hiatus";
    default: return "";
  }
}

function mapCountryToType(country: string | undefined): string {
  switch (country?.toLowerCase()) {
    case "kr": return "Manhwa";
    case "cn": return "Manhua";
    case "jp": return "Manga";
    default: return "Comic";
  }
}

function extractTags(comic: ComickSearchResult | ComickComicData): string[] {
  if (comic.md_comic_md_genres) {
    return comic.md_comic_md_genres.map((g) => g.md_genres.name);
  }
  if (comic.genres) {
    return comic.genres.map((g) => g.name);
  }
  return [];
}

function buildThumbnailUrl(thumbnail: string | undefined): string {
  if (!thumbnail) return "";
  if (thumbnail.startsWith("http")) return thumbnail;
  return `https://meo.comick.pictures/${thumbnail}`;
}

// search

export async function search(
  query: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: SearchOptions,
): Promise<SearchResult[]> {
  if (!query || query.trim().length < 2) return [];

  const params = new URLSearchParams();
  params.set("q", query.trim());
  params.set("limit", "20");

  const url = `${BASE_URL}/api/search?${params.toString()}`;
  const raw = await throttledFetch(url, { accept: "application/json" });

  let data: ComickSearchResult[];
  try {
    const parsed = JSON.parse(raw);
    data = Array.isArray(parsed) ? parsed : parsed.data ?? [];
  } catch {
    logWarn("source.comick.search_parse_error", { url });
    return [];
  }

  return data.map((comic) => ({
    sourceId: comic.slug,
    title: comic.title,
    slug: comic.slug,
    coverUrl: buildThumbnailUrl(comic.default_thumbnail ?? comic.thumbnail),
    year: null,
    status: mapStatus(comic.status),
    type: mapCountryToType(comic.country),
    authors: [],
    tags: extractTags(comic),
    source: "comick",
  }));
}

// getSeriesDetail

export async function getSeriesDetail(
  sourceId: string,
): Promise<SeriesDetail> {
  const url = `${BASE_URL}/comic/${sourceId}`;
  const html = await throttledFetch(url);
  const $ = cheerio.load(html);

  // ComicK embeds comic data in a #comic-data script or JSON-LD
  let comic: ComickComicData | null = null;

  const comicDataEl = $("#comic-data");
  if (comicDataEl.length > 0) {
    try {
      comic = JSON.parse(comicDataEl.text());
    } catch { /* fallback below */ }
  }

  // Fallback: try __NEXT_DATA__ or script[type="application/json"]
  if (!comic) {
    $("script").each((_, el) => {
      const text = $(el).text();
      if (text.includes(sourceId) && text.includes('"slug"')) {
        try {
          const parsed = JSON.parse(text);
          const candidate = parsed?.props?.pageProps?.comic
            ?? parsed?.comic
            ?? parsed?.props?.pageProps?.data;
          if (candidate?.slug) {
            comic = candidate;
            return false;
          }
        } catch { /* skip */ }
      }
    });
  }

  // Fallback: parse from meta tags + HTML
  const title = comic?.title
    ?? $("h1").first().text().trim()
    ?? $("meta[property='og:title']").attr("content")
    ?? sourceId;

  const description = comic?.desc
    ?? comic?.description
    ?? $("meta[property='og:description']").attr("content")
    ?? "";

  const coverUrl = buildThumbnailUrl(comic?.default_thumbnail ?? comic?.thumbnail)
    || $("meta[property='og:image']").attr("content")
    || "";

  const authors = comic?.authors?.map((a) => a.name) ?? [];
  const artists = comic?.artists?.map((a) => a.name) ?? [];
  const allAuthors = [...new Set([...authors, ...artists])];

  const tags = comic ? extractTags(comic) : [];
  const status = mapStatus(comic?.status);
  const type = mapCountryToType(comic?.country);
  const isAdult = comic?.content_rating === "erotica" || comic?.content_rating === "suggestive";

  return {
    sourceId,
    title,
    slug: sourceId,
    coverUrl,
    description,
    authors: allAuthors,
    tags,
    type,
    status,
    year: null,
    isAdult,
    isOfficial: false,
    anilistUrl: null,
    relatedSeries: [],
  };
}

// getChapterList

export async function getChapterList(
  sourceId: string,
): Promise<Chapter[]> {
  const chapters: Chapter[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= 50; page += 1) {
    const url = `${BASE_URL}/api/comics/${sourceId}/chapter-list?lang=en&page=${page}`;
    const raw = await throttledFetch(url, { accept: "application/json" });

    let response: ComickChapterListResponse;
    try {
      response = JSON.parse(raw);
    } catch {
      logWarn("source.comick.chapter_parse_error", { url });
      break;
    }

    const chapterData = response.data ?? response.chapters ?? [];
    if (chapterData.length === 0) break;

    for (const ch of chapterData) {
      if (!ch.hid || seen.has(ch.hid)) continue;
      seen.add(ch.hid);

      const chapterNo = ch.chap ? parseFloat(ch.chap) : 0;
      const volPrefix = ch.vol ? `Vol.${ch.vol} ` : "";
      const chapLabel = ch.chap ? `Chapter ${ch.chap}` : "";
      const titleSuffix = ch.title ? ` - ${ch.title}` : "";
      const title = `${volPrefix}${chapLabel}${titleSuffix}`.trim() || `Chapter ${chapterNo}`;

      chapters.push({
        sourceChapterId: ch.hid,
        chapterNo: Number.isFinite(chapterNo) ? chapterNo : 0,
        title,
      });
    }

    const lastPage = response.pagination?.last_page ?? 1;
    if (page >= lastPage) break;
  }

  return chapters;
}

// getChapterPages

export async function getChapterPages(
  chapterSourceId: string,
): Promise<ChapterPage[]> {
  const url = `${BASE_URL}/chapter/${chapterSourceId}`;
  const html = await throttledFetch(url);
  const $ = cheerio.load(html);

  // ComicK stores page images in #sv-data or similar embedded JSON
  let images: string[] = [];

  const svDataEl = $("#sv-data");
  if (svDataEl.length > 0) {
    try {
      const data: ComickPageListData = JSON.parse(svDataEl.text());
      images = data.chapter?.images?.map((img) => img.url) ?? [];
    } catch { /* fallback below */ }
  }

  // Fallback: look for image data in script tags
  if (images.length === 0) {
    $("script").each((_, el) => {
      const text = $(el).text();
      if (text.includes('"images"') && text.includes('"url"')) {
        try {
          const parsed = JSON.parse(text);
          const chapterImages = parsed?.chapter?.images
            ?? parsed?.props?.pageProps?.chapter?.images
            ?? parsed?.images;
          if (Array.isArray(chapterImages)) {
            images = chapterImages.map((img: ComickChapterPage) => img.url).filter(Boolean);
            if (images.length > 0) return false;
          }
        } catch { /* skip */ }
      }
    });
  }

  // Fallback: extract reader images from DOM
  if (images.length === 0) {
    $("img[data-index], .reader-main img, .chapter-reader img").each((_, img) => {
      const src = $(img).attr("src") || $(img).attr("data-src");
      if (src && src.startsWith("http") && /\.(png|jpe?g|webp|avif|gif)/i.test(src)) {
        images.push(src);
      }
    });
  }

  return images.map((imageUrl, index) => ({ index, imageUrl }));
}

function getChapterUrl(chapterSourceId: string) {
  return `${BASE_URL}/chapter/${chapterSourceId}`;
}

registerSource({
  name: "comick",
  displayName: "ComicK",
  baseUrl: BASE_URL,
  isNsfw: false,
  getChapterUrl,
  search,
  getSeriesDetail,
  getChapterList,
  getChapterPages,
});
