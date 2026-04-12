import * as cheerio from "cheerio";
import type {
  SearchResult,
  SeriesDetail,
  Chapter,
  ChapterPage,
  SearchOptions,
} from "./types";
import { registerSource } from "./registry";
import { createFetcher } from "./fetcher";

const BASE_URL = "https://flamecomics.xyz";
const CDN_URL = "https://cdn.flamecomics.xyz";

const fetcher = createFetcher({
  name: "FlameComics",
  baseUrl: BASE_URL,
  requestDelayMs: 500,
  requestTimeoutMs: 15000,
  retryDelayMs: 1000,
});

// BuildId management for Next.js data API
let cachedBuildId: string | null = null;
let buildIdExpiresAt = 0;
const BUILD_ID_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function clearCache() {
  fetcher.clearCache();
  cachedBuildId = null;
  buildIdExpiresAt = 0;
}

// Next.js buildId management

export async function fetchBuildId(): Promise<string> {
  if (cachedBuildId && buildIdExpiresAt > Date.now()) {
    return cachedBuildId;
  }

  const html = await fetcher.fetch(BASE_URL, { accept: "text/html" });
  const $ = cheerio.load(html);

  const nextDataScript = $("#__NEXT_DATA__").text();
  if (nextDataScript) {
    try {
      const nextData = JSON.parse(nextDataScript);
      if (nextData.buildId) {
        cachedBuildId = nextData.buildId;
        buildIdExpiresAt = Date.now() + BUILD_ID_TTL_MS;
        return cachedBuildId as string;
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
    const raw = await fetcher.fetch(url, { accept: "application/json" });
    return JSON.parse(raw);
  } catch (error) {
    // On 404, refresh buildId and retry once
    if (error instanceof Error && error.message.includes("404")) {
      cachedBuildId = null;
      buildIdExpiresAt = 0;
      // Clear cached homepage response so fetchBuildId gets a fresh one
      fetcher.evictCacheEntries((key) =>
        key.includes(BASE_URL) && !key.includes("/_next/data/"),
      );
      const newBuildId = await fetchBuildId();
      let retryUrl = `${BASE_URL}/_next/data/${newBuildId}/${path}.json`;
      if (queryParams) {
        retryUrl += `?${new URLSearchParams(queryParams).toString()}`;
      }
      const raw = await fetcher.fetch(retryUrl, { accept: "application/json" });
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
  categories?: string[];
  author?: string | string[];
  artist?: string | string[];
  status?: string;
}

interface FlameChapter {
  chapter: number | string;
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
  if (!cover) return `${CDN_URL}/uploads/images/series/${seriesId}/cover.jpg`;
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

function flattenNames(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function extractAuthors(series: FlameSeries): string[] {
  const authors = flattenNames(series.author);
  const artists = flattenNames(series.artist);
  return [...new Set([...authors, ...artists])];
}

function extractTags(series: FlameSeries): string[] {
  return series.tags ?? series.categories ?? [];
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
    pageProps?: { series?: FlameSeries[]; data?: FlameSeries[] };
  };

  const allSeries = data?.pageProps?.series ?? data?.pageProps?.data ?? [];
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
    authors: extractAuthors(series),
    tags: extractTags(series),
    source: "flamecomics",
  }));
}

// getSeriesDetail

export async function getSeriesDetail(
  sourceId: string,
): Promise<SeriesDetail> {
  const data = await fetchNextData(`series/${sourceId}`, { id: sourceId }) as {
    pageProps?: { data?: FlameSeries; series?: FlameSeries; chapters?: FlameChapter[] };
  };

  const series = data?.pageProps?.data ?? data?.pageProps?.series;
  if (!series) {
    throw new Error(`FlameComics: series not found: ${sourceId}`);
  }

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
    authors: extractAuthors(series),
    tags: extractTags(series),
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

  return rawChapters.map((ch) => {
    const chapterNo = typeof ch.chapter === "number" ? ch.chapter : parseFloat(String(ch.chapter)) || 0;
    return {
      sourceChapterId: `${sourceId}/${ch.token}`,
      chapterNo,
      title: ch.title
        ? `Chapter ${chapterNo} - ${ch.title}`
        : `Chapter ${chapterNo}`,
    };
  }).sort((a, b) => a.chapterNo - b.chapterNo);
}

// getChapterPages

export async function getChapterPages(
  chapterSourceId: string,
): Promise<ChapterPage[]> {
  // chapterSourceId is "{seriesId}/{token}"
  const parts = chapterSourceId.split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`FlameComics: invalid chapterSourceId format: "${chapterSourceId}"`);
  }
  const seriesId = parts[0];
  const token = parts[1];

  const numericSeriesId = parseInt(seriesId, 10);
  if (!Number.isFinite(numericSeriesId)) {
    throw new Error(`FlameComics: non-numeric seriesId in chapterSourceId: "${chapterSourceId}"`);
  }

  const data = await fetchNextData(`series/${seriesId}/${token}`, {
    id: seriesId,
    token,
  }) as {
    pageProps?: {
      images?: FlamePageImage[] | Record<string, FlamePageImage>;
      release_date?: number;
      chapter?: {
        images?: FlamePageImage[] | Record<string, FlamePageImage>;
        release_date?: number;
        series_id?: number;
      };
      data?: { images?: FlamePageImage[]; release_date?: number };
    };
  };

  const pageProps = data?.pageProps;
  const rawImages = pageProps?.chapter?.images ?? pageProps?.images ?? pageProps?.data?.images;
  const releaseDate = pageProps?.chapter?.release_date ?? pageProps?.release_date ?? pageProps?.data?.release_date;

  // Images can be an array or a dict with numeric string keys
  let images: FlamePageImage[];
  if (Array.isArray(rawImages)) {
    images = rawImages;
  } else if (rawImages && typeof rawImages === "object") {
    images = Object.keys(rawImages)
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
      .map((k) => rawImages[k]!);
  } else {
    images = [];
  }

  return images.map((img, index) => ({
    index,
    imageUrl: buildPageImageUrl(numericSeriesId, img.name, releaseDate),
  }));
}

function parseChapterSourceId(chapterSourceId: string): { seriesId: string; token: string } {
  const parts = chapterSourceId.split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`FlameComics: invalid chapterSourceId format: "${chapterSourceId}"`);
  }
  return { seriesId: parts[0], token: parts[1] };
}

function getChapterUrl(chapterSourceId: string) {
  const { seriesId, token } = parseChapterSourceId(chapterSourceId);
  return `${BASE_URL}/series/${seriesId}/${token}`;
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
