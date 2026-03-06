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

const BASE_URL = "https://madaradex.org";
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

function getCacheKey(
  url: string,
  options?: { method?: string; body?: string; referer?: string },
) {
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
        lastError = error instanceof Error ? error : new Error("Unknown MadaraDex fetch error");

        if (isRetryableError(lastError) && attempt < MAX_RETRIES) {
          logWarn("source.madaradex.retry", {
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

    const finalError = lastError ?? new Error("Unknown MadaraDex fetch error");
    logError("source.madaradex.request_failed", finalError, {
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
    headers["Referer"] = options.referer;
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
    throw new Error(
      `MadaraDex request failed: ${res.status} ${res.statusText} — ${url}`,
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

// Helpers

function parseSlug(href: string): string {
  const match = href.match(/\/(?:manga|title)\/([^/?#]+)/);
  return match ? match[1].replace(/\/$/, "") : "";
}

function parseChapterSlug(href: string): string {
  // /manga/{slug}/{chapter-slug}/ or /{chapter-slug}/
  const match = href.match(/\/([^/?#]+)\/?$/);
  return match ? match[1] : "";
}

function parseChapterNo(text: string): number {
  const match = text.match(/(?:Chapter|Ch\.?)\s*([\d.]+)/i);
  return match ? parseFloat(match[1]) : 0;
}

// search

export async function search(
  query: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: SearchOptions,
): Promise<SearchResult[]> {
  const params = new URLSearchParams();
  params.set("s", query);
  params.set("post_type", "wp-manga");

  const url = `${BASE_URL}/?${params.toString()}`;
  const html = await throttledFetch(url);
  const $ = cheerio.load(html);

  const results: SearchResult[] = [];

  // Madara search results: .c-tabs-item .row.c-tabs-item__content or .search-wrap
  $(".c-tabs-item__content, .row.c-tabs-item__content").each((_, el) => {
    const item = $(el);

    const link = item.find("a[href*='/title/']").first();
    if (!link.length) return;

    const href = link.attr("href") ?? "";
    const slug = parseSlug(href);
    if (!slug) return;

    const title =
      item.find(".post-title a, .tab-summary .post-title a, h3 a, h4 a").first().text().trim() ||
      link.attr("title")?.trim() || "";
    if (!title) return;

    if (results.some((r) => r.slug === slug)) return;

    const coverUrl =
      item.find("img").first().attr("data-src") ||
      item.find("img").first().attr("src") || "";

    const authors: string[] = [];
    item.find(".mg_author a, .summary-content a[href*='manga-author'], .post-content a[href*='manga-author']").each((_, a) => {
      const name = $(a).text().trim();
      if (name && !authors.includes(name)) authors.push(name);
    });

    const tags: string[] = [];
    item.find(".mg_genres a, .summary-content a[href*='manga-genre'], .post-content a[href*='manga-genre']").each((_, a) => {
      const tag = $(a).text().trim();
      if (tag && !tags.includes(tag)) tags.push(tag);
    });

    let status = "";
    item.find(".mg_status, .summary-content").each((_, s) => {
      const text = $(s).text();
      if (text.includes("OnGoing") || text.includes("Ongoing")) status = "Ongoing";
      if (text.includes("Completed")) status = "Completed";
    });

    results.push({
      sourceId: slug,
      title,
      slug,
      coverUrl,
      year: null,
      status,
      type: "Manhwa",
      authors,
      tags,
      source: "madaradex",
    });
  });

  return results;
}

// getSeriesDetail

export async function getSeriesDetail(
  sourceId: string,
): Promise<SeriesDetail> {
  const url = `${BASE_URL}/title/${sourceId}/`;
  const html = await throttledFetch(url);
  const $ = cheerio.load(html);

  const title =
    $(".post-title h1, .post-title h3").first().text().trim() ||
    $("title").text().replace(/ [-–|][\s\S]*/, "").trim();

  const coverUrl =
    $(".summary_image img").first().attr("data-src") ||
    $(".summary_image img").first().attr("src") || "";

  const description =
    $(".summary__content .manga-excerpt, .description-summary .summary__content, div.summary__content").first().text().trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() || "";

  const authors: string[] = [];
  $(".author-content a, .post-content a[href*='manga-author']").each((_, a) => {
    const name = $(a).text().trim();
    if (name && !authors.includes(name)) authors.push(name);
  });

  const tags: string[] = [];
  $(".genres-content a, .post-content a[href*='manga-genre']").each((_, a) => {
    const tag = $(a).text().trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
  });

  let status = "";
  $(".post-status .summary-content, .post-content_item .summary-content").each((_, el) => {
    const text = $(el).text().trim();
    if (text.includes("OnGoing") || text.includes("Ongoing")) status = "Ongoing";
    if (text.includes("Completed")) status = "Completed";
    if (text.includes("Hiatus")) status = "Hiatus";
    if (text.includes("Canceled") || text.includes("Cancelled")) status = "Canceled";
  });

  let type = "Manhwa";
  $(".post-content_item").each((_, el) => {
    const label = $(el).find(".summary-heading").text().trim().toLowerCase();
    if (label.includes("type")) {
      const value = $(el).find(".summary-content").text().trim();
      if (value) type = value;
    }
  });

  let year: number | null = null;
  $(".post-content_item").each((_, el) => {
    const label = $(el).find(".summary-heading").text().trim().toLowerCase();
    if (label.includes("release") || label.includes("year")) {
      const match = $(el).find(".summary-content").text().match(/(\d{4})/);
      if (match) year = parseInt(match[1], 10);
    }
  });

  const relatedSeries: SeriesDetail["relatedSeries"] = [];
  $(".related-manga a[href*='/title/'], .manga-related a[href*='/title/']").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const relSlug = parseSlug(href);
    if (!relSlug || relSlug === sourceId) return;
    const relTitle = $(a).text().trim();
    if (relTitle && !relatedSeries.some((r) => r.sourceId === relSlug)) {
      relatedSeries.push({
        sourceId: relSlug,
        title: relTitle,
        relationship: "Related",
      });
    }
  });

  return {
    sourceId,
    title,
    slug: sourceId,
    coverUrl,
    description,
    authors,
    tags,
    type,
    status,
    year,
    isAdult: true,
    isOfficial: false,
    anilistUrl: null,
    relatedSeries,
  };
}

// getChapterList

export async function getChapterList(
  sourceId: string,
): Promise<Chapter[]> {
  // Madara loads chapters via AJAX POST
  const url = `${BASE_URL}/title/${sourceId}/ajax/chapters/`;
  const html = await throttledFetch(url, {
    method: "POST",
    referer: `${BASE_URL}/title/${sourceId}/`,
  });
  const $ = cheerio.load(html);

  const chapters: Chapter[] = [];

  $("li.wp-manga-chapter a").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const chapterSlug = parseChapterSlug(href);
    if (!chapterSlug) return;

    const text = $(a).text().trim();
    if (!text) return;

    const chapterNo = parseChapterNo(text);

    chapters.push({
      sourceChapterId: `${sourceId}/${chapterSlug}`,
      chapterNo,
      title: text,
    });
  });

  // Madara returns newest-first; reverse to ascending
  chapters.reverse();

  return chapters;
}

// getChapterPages

export async function getChapterPages(
  chapterSourceId: string,
): Promise<ChapterPage[]> {
  // chapterSourceId is "{mangaSlug}/{chapterSlug}"
  const url = `${BASE_URL}/title/${chapterSourceId}/`;
  const html = await throttledFetch(url, {
    referer: `${BASE_URL}/`,
  });
  const $ = cheerio.load(html);

  const pages: ChapterPage[] = [];

  $(".reading-content .page-break img, .reading-content img").each((_, img) => {
    const src =
      $(img).attr("data-src")?.trim() ||
      $(img).attr("src")?.trim() ||
      $(img).attr("data-lazy-src")?.trim();
    if (!src) return;
    if (!src.startsWith("http")) return;

    pages.push({
      index: pages.length,
      imageUrl: src,
    });
  });

  return pages;
}

function getChapterUrl(chapterSourceId: string) {
  return `${BASE_URL}/title/${chapterSourceId}/?style=list`;
}

registerSource({
  name: "madaradex",
  displayName: "MadaraDex",
  baseUrl: BASE_URL,
  isNsfw: true,
  getChapterUrl,
  search,
  getSeriesDetail,
  getChapterList,
  getChapterPages,
});
