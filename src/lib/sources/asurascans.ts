import * as cheerio from "cheerio";
import type {
  SearchResult,
  SeriesDetail,
  Chapter,
  ChapterPage,
  SearchOptions,
} from "./types";
import { registerSource } from "./registry";
import { logWarn } from "@/lib/server/log";
import { createFetcher } from "./fetcher";

const BASE_URL = "https://asurascans.com";
const API_URL = "https://api.asurascans.com/api";

const fetcher = createFetcher({
  name: "AsuraScans",
  baseUrl: BASE_URL,
  requestDelayMs: 500,
  requestTimeoutMs: 12000,
  retryDelayMs: 600,
  defaultAccept: "application/json,text/html",
});

export function clearCache() {
  fetcher.clearCache();
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

// Astro v5 embeds hydration state as `[typeCode, data]` tuples:
//   [0, primitive_or_object]  — primitive or plain object whose fields are also wrapped
//   [1, array_of_wrapped]     — array whose elements are themselves wrapped
//   [2..], etc.               — other types (Set, Map, Date, ...) we pass through
// The top-level `props` JSON is a plain object whose values are wrapped.
// This walker returns the "real" JS value with all wrappers stripped.
function unwrapAstroValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    if (
      value.length === 2 &&
      typeof value[0] === "number" &&
      Number.isInteger(value[0]) &&
      value[0] >= 0
    ) {
      const [type, data] = value as [number, unknown];
      if (type === 1 && Array.isArray(data)) {
        return data.map(unwrapAstroValue);
      }
      // type 0 (primitive or object) and any other type: unwrap the payload.
      return unwrapAstroValue(data);
    }
    return value.map(unwrapAstroValue);
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = unwrapAstroValue(v);
  }
  return result;
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
    const raw = await fetcher.fetch(url, { accept: "application/json" });

    let data: AsuraManga[];
    let hasMore = false;
    try {
      const parsed = JSON.parse(raw);
      data = parsed.data ?? (Array.isArray(parsed) ? parsed : []);
      hasMore = parsed.meta?.has_more ?? false;
    } catch (e) {
      logWarn("source.asurascans.search_parse_error", {
        url,
        error: e instanceof Error ? e.message : String(e),
        preview: raw.substring(0, 200),
      });
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
  const raw = await fetcher.fetch(url, { accept: "application/json" });

  let manga: AsuraManga;
  try {
    const parsed = JSON.parse(raw);
    // Handle various response formats:
    // { data: { series: {...} } }  — wrapped detail
    // { data: {...} }              — data wrapper
    // { series: {...} }            — direct series
    // {...}                        — bare manga object
    manga = parsed?.data?.series ?? parsed?.series ?? parsed?.data ?? parsed;
  } catch (e) {
    throw new Error(`Failed to parse series detail for ${sourceId}: ${e instanceof Error ? e.message : String(e)}`);
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
  const chapters: Chapter[] = [];
  const seen = new Set<string>();

  // Primary: dedicated chapters API endpoint
  try {
    const apiUrl = `${API_URL}/series/${sourceId}/chapters`;
    const raw = await fetcher.fetch(apiUrl, { accept: "application/json" });
    const parsed = JSON.parse(raw);
    const chapterList = parsed.data ?? parsed.chapters ?? (Array.isArray(parsed) ? parsed : []);
    for (const ch of chapterList) {
      addChapter(chapters, seen, ch, sourceId);
    }
  } catch (e) {
    logWarn("source.asurascans.chapter_api_failed", {
      sourceId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Fallback: scrape HTML page for Astro-embedded chapter data
  if (chapters.length === 0) {
    const pageUrl = `${BASE_URL}/comics/${sourceId}`;
    const html = await fetcher.fetch(pageUrl, { accept: "text/html" });
    const $ = cheerio.load(html);

    $("script").each((_, el) => {
      const text = $(el).text();
      if (!text.includes("chapters") || !text.includes("number")) return;

      try {
        const parsed = JSON.parse(text);
        const rawChapters = extractChaptersFromParsed(parsed);
        if (rawChapters.length > 0) {
          for (const ch of rawChapters) {
            addChapter(chapters, seen, ch, sourceId);
          }
          return false; // break
        }
      } catch { /* not JSON, skip */ }
    });

    if (chapters.length === 0) {
      $("[props]").each((_, el) => {
        const propsStr = $(el).attr("props") || "";
        if (!propsStr.includes("chapters")) return;

        try {
          const parsed = JSON.parse(propsStr);
          const rawChapters = extractChaptersFromParsed(parsed);
          for (const ch of rawChapters) {
            addChapter(chapters, seen, ch, sourceId);
          }
        } catch { /* skip */ }
      });
    }
  }

  return chapters.sort((a, b) => a.chapterNo - b.chapterNo);
}

function extractChaptersFromParsed(parsed: unknown): AsuraChapter[] {
  const unwrapped = unwrapAstroValue(parsed);
  if (!unwrapped || typeof unwrapped !== "object") return [];

  // Direct chapters array
  if (Array.isArray((unwrapped as Record<string, unknown>).chapters)) {
    return (unwrapped as { chapters: AsuraChapter[] }).chapters;
  }

  // Nested in data
  const data = (unwrapped as Record<string, unknown>).data;
  if (data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).chapters)) {
    return (data as { chapters: AsuraChapter[] }).chapters;
  }

  // Walk nested arrays looking for a chapters field
  if (Array.isArray(unwrapped)) {
    for (const item of unwrapped) {
      const found = extractChaptersFromParsed(item);
      if (found.length > 0) return found;
    }
  }

  return [];
}

function addChapter(chapters: Chapter[], seen: Set<string>, ch: AsuraChapter, seriesSlug: string) {
  if (ch.is_locked) return;

  const chapterNo = typeof ch.number === "number" ? ch.number : parseFloat(String(ch.number)) || 0;
  const slug = ch.series_slug || seriesSlug;
  const sourceChapterId = `${slug}/chapter/${chapterNo}`;

  if (seen.has(sourceChapterId)) return;
  seen.add(sourceChapterId);

  const title = ch.title
    ? `Chapter ${chapterNo} - ${ch.title}`
    : `Chapter ${chapterNo}`;

  chapters.push({
    sourceChapterId,
    chapterNo,
    title,
  });
}

// getChapterPages

export async function getChapterPages(
  chapterSourceId: string,
): Promise<ChapterPage[]> {
  // chapterSourceId is "{slug}/chapter/{chapterNo}"
  const pageUrl = `${BASE_URL}/comics/${chapterSourceId}`;
  const html = await fetcher.fetch(pageUrl, { accept: "text/html" });
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

  // Primary path (AsuraScans is an Astro v5 site): hydration state lives inside
  // astro-island[props], encoded with [typeCode, data] tuples.
  if (pages.length === 0) {
    $("astro-island[props], [props]").each((_, el) => {
      const propsStr = $(el).attr("props") || "";
      if (!propsStr.includes("pages")) return;

      try {
        const parsed = JSON.parse(propsStr);
        const rawPages = extractPagesFromParsed(parsed);
        if (rawPages.length > 0) {
          for (let i = 0; i < rawPages.length; i++) {
            pages.push({ index: i, imageUrl: rawPages[i]!.url });
          }
          return false; // break
        }
      } catch { /* skip */ }
    });
  }

  // Fallback: extract images from DOM (case-insensitive alt match via filter)
  if (pages.length === 0) {
    $("img").each((_, img) => {
      const src = $(img).attr("src") || $(img).attr("data-src");
      if (!src || !src.startsWith("http") || !/\.(png|jpe?g|webp|avif|gif)/i.test(src)) return;

      const alt = ($(img).attr("alt") || "").toLowerCase();
      const hasIndex = $(img).attr("data-index") !== undefined;
      const isCdnImage = src.includes("cdn.asurascans.com") && src.includes("/chapters/");
      const isPageAlt = alt.includes("page");

      if (isPageAlt || hasIndex || isCdnImage) {
        pages.push({ index: pages.length, imageUrl: src });
      }
    });
  }

  return pages;
}

function extractPagesFromParsed(parsed: unknown): AsuraPage[] {
  const unwrapped = unwrapAstroValue(parsed);
  if (!unwrapped || typeof unwrapped !== "object") return [];

  const fromObject = (obj: Record<string, unknown>): AsuraPage[] => {
    if (Array.isArray(obj.pages)) {
      return (obj.pages as AsuraPage[]).filter((p) => p && typeof p === "object" && typeof p.url === "string" && p.url);
    }
    return [];
  };

  if (!Array.isArray(unwrapped)) {
    const obj = unwrapped as Record<string, unknown>;
    const direct = fromObject(obj);
    if (direct.length > 0) return direct;

    for (const key of ["data", "chapter", "props"]) {
      const nested = obj[key];
      if (nested && typeof nested === "object") {
        const found = extractPagesFromParsed(nested);
        if (found.length > 0) return found;
      }
    }
  } else {
    for (const item of unwrapped) {
      const found = extractPagesFromParsed(item);
      if (found.length > 0) return found;
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
