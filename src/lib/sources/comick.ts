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

const BASE_URL = "https://comick.live";
const MAX_CHAPTER_PAGES = 50;

const fetcher = createFetcher({
  name: "ComicK",
  baseUrl: BASE_URL,
  requestDelayMs: 500,
  requestTimeoutMs: 12000,
  retryDelayMs: 600,
});

export function clearCache() {
  fetcher.clearCache();
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
  if (!query || query.trim().length < 3) return [];

  const params = new URLSearchParams();
  params.set("q", query.trim());
  params.set("limit", "20");

  const url = `${BASE_URL}/api/search?${params.toString()}`;
  const raw = await fetcher.fetch(url, { accept: "application/json" });

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
  const html = await fetcher.fetch(url);
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

  for (let page = 1; page <= MAX_CHAPTER_PAGES; page += 1) {
    const url = `${BASE_URL}/api/comics/${sourceId}/chapter-list?lang=en&page=${page}`;
    const raw = await fetcher.fetch(url, { accept: "application/json" });

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

    if (page === MAX_CHAPTER_PAGES) {
      logWarn("source.comick.chapter_pagination_cap", {
        sourceId,
        pagesScanned: MAX_CHAPTER_PAGES,
        chaptersFound: chapters.length,
        apiLastPage: lastPage,
      });
    }
  }

  return chapters;
}

// getChapterPages

export async function getChapterPages(
  chapterSourceId: string,
): Promise<ChapterPage[]> {
  const url = `${BASE_URL}/chapter/${chapterSourceId}`;
  const html = await fetcher.fetch(url);
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
