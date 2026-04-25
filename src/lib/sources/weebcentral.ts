import * as cheerio from "cheerio";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appSetting } from "@/lib/db/schema";
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

const BASE_URL = "https://weebcentral.com";
const COVER_BASE = "https://temp.compsci88.com/cover/fallback";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = 300;
const CHAPTER_PAGE_REQUEST_DELAY_MS = 1_200;
const BACKGROUND_REQUEST_DELAY_MS = 1_500;
const REQUEST_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 600;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 5_000;
const MAX_RATE_LIMIT_BACKOFF_MS = 30_000;
const SHARED_THROTTLE_KEY = "source:weebcentral:throttle";

// Rate-limiting: serial queue inside a process plus shared backoff state in SQLite
// so the reader and worker containers do not hammer WeebCentral independently.

let lastRequestTime = 0;
let requestQueue: Promise<void> = Promise.resolve();
const responseCache = new Map<string, { expiresAt: number; value: string }>();
const inflightRequests = new Map<string, Promise<string>>();

interface SharedThrottleState {
  nextAllowedAt: number;
}

class RateLimitError extends Error {
  constructor(message: string, readonly retryAfterMs: number) {
    super(message);
    this.name = "RateLimitError";
  }
}

function getCacheKey(
  url: string,
  options?: { htmx?: boolean; method?: string; body?: string; referer?: string },
) {
  return JSON.stringify({
    url,
    method: options?.method || "GET",
    body: options?.body || "",
    htmx: options?.htmx || false,
    referer: options?.referer || "",
  });
}

function parseSharedThrottleState(valueJson?: string | null): SharedThrottleState {
  if (!valueJson) {
    return { nextAllowedAt: 0 };
  }

  try {
    const parsed = JSON.parse(valueJson) as Partial<SharedThrottleState>;
    return {
      nextAllowedAt: typeof parsed.nextAllowedAt === "number" ? parsed.nextAllowedAt : 0,
    };
  } catch {
    return { nextAllowedAt: 0 };
  }
}

function reserveLocalSlot(delayMs: number) {
  const now = Date.now();
  const reservedAt = Math.max(now, lastRequestTime);
  lastRequestTime = reservedAt + delayMs;
  return reservedAt;
}

function reserveSharedSlot(delayMs: number) {
  if (process.env.NODE_ENV === "test") {
    return reserveLocalSlot(0);
  }

  try {
    return getDb().transaction((tx) => {
      const row = tx
        .select({ valueJson: appSetting.valueJson })
        .from(appSetting)
        .where(eq(appSetting.key, SHARED_THROTTLE_KEY))
        .get();
      const state = parseSharedThrottleState(row?.valueJson);
      const reservedAt = Math.max(Date.now(), state.nextAllowedAt);

      tx
        .insert(appSetting)
        .values({
          key: SHARED_THROTTLE_KEY,
          valueJson: JSON.stringify({ nextAllowedAt: reservedAt + delayMs }),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: appSetting.key,
          set: {
            valueJson: JSON.stringify({ nextAllowedAt: reservedAt + delayMs }),
            updatedAt: new Date(),
          },
        })
        .run();

      return reservedAt;
    });
  } catch (error) {
    logWarn("source.weebcentral.shared_throttle_unavailable", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return reserveLocalSlot(delayMs);
  }
}

function applySharedBackoff(backoffMs: number) {
  if (process.env.NODE_ENV === "test") {
    lastRequestTime = Math.max(lastRequestTime, Date.now() + backoffMs);
    return;
  }

  try {
    getDb().transaction((tx) => {
      const row = tx
        .select({ valueJson: appSetting.valueJson })
        .from(appSetting)
        .where(eq(appSetting.key, SHARED_THROTTLE_KEY))
        .get();
      const state = parseSharedThrottleState(row?.valueJson);
      const nextAllowedAt = Math.max(state.nextAllowedAt, Date.now() + backoffMs);

      tx
        .insert(appSetting)
        .values({
          key: SHARED_THROTTLE_KEY,
          valueJson: JSON.stringify({ nextAllowedAt }),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: appSetting.key,
          set: {
            valueJson: JSON.stringify({ nextAllowedAt }),
            updatedAt: new Date(),
          },
        })
        .run();
    });
  } catch (error) {
    logWarn("source.weebcentral.shared_backoff_unavailable", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    lastRequestTime = Math.max(lastRequestTime, Date.now() + backoffMs);
  }
}

function parseRetryAfterMs(value: string | null) {
  if (!value) {
    return null;
  }

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(dateMs - Date.now(), 0);
  }

  return null;
}

function getThrottleDelay(options?: { throttleMs?: number }) {
  const baseDelay = options?.throttleMs ?? REQUEST_DELAY_MS;
  if (process.env.RUN_BACKGROUND_WORKER === "1") {
    return Math.max(baseDelay, BACKGROUND_REQUEST_DELAY_MS);
  }

  return baseDelay;
}

function getRateLimitBackoffMs(response: Response, delayMs: number) {
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
  const baseBackoff = retryAfterMs ?? Math.max(delayMs * 4, DEFAULT_RATE_LIMIT_BACKOFF_MS);
  return Math.min(baseBackoff, MAX_RATE_LIMIT_BACKOFF_MS);
}

async function throttledFetch(
  url: string,
  options?: { htmx?: boolean; method?: string; body?: string; referer?: string; throttleMs?: number },
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
        lastError = error instanceof Error ? error : new Error("Unknown WeebCentral fetch error");

        if (isRetryableError(lastError) && attempt < MAX_RETRIES) {
          logWarn("source.weebcentral.retry", {
            url,
            attempt: attempt + 1,
            message: lastError.message,
          });
        }

        if (!isRetryableError(lastError) || attempt === MAX_RETRIES) {
          break;
        }

        const retryDelayMs = lastError instanceof RateLimitError
          ? Math.max(lastError.retryAfterMs, RETRY_DELAY_MS * (attempt + 1))
          : RETRY_DELAY_MS * (attempt + 1);
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelayMs),
        );
      }
    }

    const finalError = lastError ?? new Error("Unknown WeebCentral fetch error");
    logError("source.weebcentral.request_failed", finalError, {
      url,
      method: options?.method || "GET",
      htmx: options?.htmx || false,
      referer: options?.referer || null,
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

async function fetchWithThrottle(
  url: string,
  options: { htmx?: boolean; method?: string; body?: string; referer?: string; throttleMs?: number } | undefined,
  cacheKey: string,
) {
  const slot = requestQueue.then(async () => {
    const delayMs = getThrottleDelay(options);
    const reservedAt = reserveSharedSlot(delayMs);
    const waitMs = reservedAt - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastRequestTime = Date.now();
  });
  requestQueue = slot.catch(() => {});
  await slot;

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (options?.htmx) {
    headers["HX-Request"] = "true";
  }
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
    if (res.status === 429) {
      const delayMs = getThrottleDelay(options);
      const backoffMs = getRateLimitBackoffMs(res, delayMs);
      applySharedBackoff(backoffMs);
      throw new RateLimitError(
        `WeebCentral request failed: ${res.status} ${res.statusText} — ${url}`,
        backoffMs,
      );
    }

    throw new Error(
      `WeebCentral request failed: ${res.status} ${res.statusText} — ${url}`,
    );
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

function coverUrl(sourceId: string): string {
  return `${COVER_BASE}/${sourceId}.jpg`;
}

function getChapterUrl(chapterSourceId: string): string {
  return `${BASE_URL}/chapters/${chapterSourceId}`;
}

function parseSeriesLink(href: string): { sourceId: string; slug: string } | null {
  const match = href.match(/\/series\/([A-Z0-9]{26})(?:\/([^/?#]*))?/);
  if (!match) return null;
  return { sourceId: match[1], slug: match[2] ?? "" };
}

function parseChapterLink(href: string): string | null {
  const match = href.match(/\/chapters\/([A-Z0-9]{26})/);
  return match ? match[1] : null;
}

function parseYear(text: string): number | null {
  const match = text.match(/Released:\s*(\d{4})/);
  return match ? parseInt(match[1], 10) : null;
}

function parseBoolField(text: string, label: string): boolean {
  const re = new RegExp(`${label}:\\s*(Yes|True)`, "i");
  return re.test(text);
}

// search

export async function search(
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  // WeebCentral search results are loaded via HTMX from /search/data
  const params = new URLSearchParams();
  if (query) params.set("text", query);
  params.set("sort", options?.sort || "Best Match");
  params.set("order", options?.order || "Descending");
  params.set("display_mode", "Full Display");
  if (options?.official != null) params.set("official", options.official ? "True" : "False");
  if (options?.adult != null) params.set("adult", options.adult ? "True" : "False");
  if (options?.author) params.set("author", options.author);
  if (options?.status) {
    for (const s of options.status) params.append("included_status", s);
  }
  if (options?.type) {
    for (const t of options.type) params.append("included_type", t);
  }
  if (options?.tags) {
    for (const tag of options.tags) params.append("included_tag", tag);
  }

  const url = `${BASE_URL}/search/data?${params.toString()}`;
  const html = await throttledFetch(url, {
    htmx: true,
    referer: `${BASE_URL}/search`,
  });
  const $ = cheerio.load(html);

  const results: SearchResult[] = [];

  // Each result is an <article> containing series links
  $("article").each((_, article) => {
    const el = $(article);

    // Find the series link
    const seriesLink = el.find('a[href*="/series/"]').first();
    if (!seriesLink.length) return;

    const href = seriesLink.attr("href") ?? "";
    const parsed = parseSeriesLink(href);
    if (!parsed) return;

    // Skip duplicates
    if (results.some((r) => r.sourceId === parsed.sourceId)) return;

    // Title from the cover img alt or text content
    const imgAlt = el.find("img").first().attr("alt") || "";
    const title = imgAlt.replace(/\s*cover$/i, "").trim() ||
      el.find(".text-ellipsis, .truncate, .line-clamp-2").first().text().trim();

    if (!title) return;

    // Authors
    const authors: string[] = [];
    el.find('a[href*="/search?author="]').each((_, a) => {
      const name = $(a).text().trim();
      if (name && !authors.includes(name)) authors.push(name);
    });

    // Tags
    const tags: string[] = [];
    el.find('a[href*="/search?included_tag="]').each((_, a) => {
      const tag = $(a).text().trim();
      if (tag && !tags.includes(tag)) tags.push(tag);
    });

    // Type & status — in Full Display these are plain <strong>Label:</strong><span>Value</span>
    let type = el.find('a[href*="/search?included_type="]').first().text().trim();
    let status = el.find('a[href*="/search?included_status="]').first().text().trim();
    // Also try from tooltip (mobile view has data-tip="Manga" etc)
    if (!type) {
      const tooltip = el.find('[data-tip]').first().attr("data-tip") || "";
      if (["Manga", "Manhwa", "Manhua", "OEL"].includes(tooltip)) type = tooltip;
    }
    // Try from <strong>Type:</strong> or <strong>Status:</strong> siblings
    el.find("strong").each((_, s) => {
      const label = $(s).text().trim().replace(":", "");
      const value = $(s).next("span").text().trim();
      if (label === "Type" && !type && value) type = value;
      if (label === "Status" && !status && value) status = value;
    });

    // Year
    const year = parseYear(el.text());

    results.push({
      sourceId: parsed.sourceId,
      title,
      slug: parsed.slug,
      coverUrl: coverUrl(parsed.sourceId),
      year,
      status,
      type,
      authors,
      tags,
    });
  });

  return results;
}

// getSeriesDetail

export async function getSeriesDetail(
  sourceId: string,
): Promise<SeriesDetail> {
  const url = `${BASE_URL}/series/${sourceId}/`;
  const html = await throttledFetch(url);
  const $ = cheerio.load(html);

  const fullText = $("body").text();

  // Title
  const title =
    $("h1").first().text().trim() ||
    $("title").text().replace(/ [-–|][\s\S]*/, "").trim();

  // Slug from canonical or og:url
  let slug = "";
  const canonical =
    $('link[rel="canonical"]').attr("href") ||
    $('meta[property="og:url"]').attr("content") ||
    "";
  const parsedCanonical = parseSeriesLink(canonical);
  if (parsedCanonical) slug = parsedCanonical.slug;

  // Authors
  const authors: string[] = [];
  $('a[href*="/search?author="]').each((_, a) => {
    const name = $(a).text().trim();
    if (name && !authors.includes(name)) authors.push(name);
  });

  // Tags
  const tags: string[] = [];
  $('a[href*="/search?included_tag="]').each((_, a) => {
    const tag = $(a).text().trim();
    if (tag && !tags.includes(tag)) tags.push(tag);
  });

  // Type & Status
  const type = $('a[href*="/search?included_type="]').first().text().trim();
  const status = $('a[href*="/search?included_status="]').first().text().trim();

  // Year
  const year = parseYear(fullText);

  // Boolean fields
  const isAdult = parseBoolField(fullText, "Adult Content");
  const isOfficial = parseBoolField(fullText, "Official Translation");

  // Description — look for the text content after a "Description" heading
  let description = "";
  $("h2, h3, h4, h5, h6, strong, b").each((_, heading) => {
    if ($(heading).text().trim().toLowerCase() === "description") {
      // Grab the next sibling text or the parent's remaining text
      const next = $(heading).next();
      if (next.length) {
        description = next.text().trim();
      }
      if (!description) {
        const parent = $(heading).parent();
        const parentText = parent.text().trim();
        const idx = parentText.toLowerCase().indexOf("description");
        if (idx >= 0) {
          description = parentText
            .slice(idx + "description".length)
            .trim();
        }
      }
    }
  });
  if (!description) {
    const metaDesc =
      $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      "";
    description = metaDesc.trim();
  }

  // AniList URL. The CSS selector matches *any* href containing the
  // substring, which includes trivially-crafted `javascript:` URLs
  // embedded in scraped HTML. Parse and verify the URL is https + on
  // the expected host before accepting it — otherwise a compromised
  // or typo-squatting source page could store a javascript: URL that
  // later renders as the href on an <a> tag in the UI.
  let anilistUrl: string | null = null;
  $('a[href*="anilist.co/manga/"]').each((_, a) => {
    const raw = $(a).attr("href") ?? "";
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === "https:" && parsed.hostname === "anilist.co") {
        anilistUrl = parsed.toString();
      }
    } catch {
      // Malformed href — ignore.
    }
  });

  // Related series
  const relatedSeries: SeriesDetail["relatedSeries"] = [];
  $('a[href*="/series/"]').each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const link = parseSeriesLink(href);
    if (!link || link.sourceId === sourceId) return;

    // Try to determine relationship from surrounding text
    const parent = $(a).parent();
    const parentText = parent.text().trim();
    const linkText = $(a).text().trim();
    let relationship = "Related";
    for (const rel of [
      "Alternate Story",
      "Side Story",
      "Prequel",
      "Sequel",
      "Spin-Off",
      "Adapted From",
      "Contains",
      "Shares Characters",
    ]) {
      if (parentText.includes(rel)) {
        relationship = rel;
        break;
      }
    }

    if (
      linkText &&
      !relatedSeries.some((r) => r.sourceId === link.sourceId)
    ) {
      relatedSeries.push({
        sourceId: link.sourceId,
        title: linkText,
        relationship,
      });
    }
  });

  return {
    sourceId,
    title,
    slug,
    coverUrl: coverUrl(sourceId),
    description,
    authors,
    tags,
    type,
    status,
    year,
    isAdult,
    isOfficial,
    anilistUrl,
    relatedSeries,
  };
}

// getChapterList

export async function getChapterList(
  sourceId: string,
): Promise<Chapter[]> {
  const url = `${BASE_URL}/series/${sourceId}/full-chapter-list`;
  const html = await throttledFetch(url, { htmx: true });
  const $ = cheerio.load(html);

  const chapters: Chapter[] = [];

  $('a[href*="/chapters/"]').each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const chapterId = parseChapterLink(href);
    if (!chapterId) return;

    // The chapter label is in a direct <span> child, not inside SVGs or nested elements
    // Structure: <a> → <span class="grow"> → <span>Chapter 383</span>
    const labelSpan = $(a).find("span.grow > span").first();
    const text = labelSpan.length ? labelSpan.text().trim() : "";

    if (!text) return;

    const numMatch = text.match(/(?:Chapter|Prologue|Volume)\s+([\d.]+)/i);
    const chapterNo = numMatch ? parseFloat(numMatch[1]) : 0;

    // WeebCentral embeds ISO UTC timestamps on each row's <time> element.
    const datetime = $(a).find("time[datetime]").attr("datetime");
    const parsed = datetime ? Date.parse(datetime) : NaN;
    const publishedAt = Number.isFinite(parsed) ? parsed : null;

    chapters.push({
      sourceChapterId: chapterId,
      chapterNo,
      title: text,
      publishedAt,
    });
  });

  // Source returns newest-first; reverse to ascending (oldest first)
  chapters.reverse();

  return chapters;
}

// getChapterPages

export async function getChapterPages(
  chapterSourceId: string,
): Promise<ChapterPage[]> {
  const url = `${BASE_URL}/chapters/${chapterSourceId}/images?is_prev=False&current_page=1&reading_style=long_strip`;
  const html = await throttledFetch(url, {
    htmx: true,
    referer: getChapterUrl(chapterSourceId),
    throttleMs: CHAPTER_PAGE_REQUEST_DELAY_MS,
  });
  const $ = cheerio.load(html);

  const pages: ChapterPage[] = [];

  $("img").each((i, img) => {
    const src =
      $(img).attr("src") || $(img).attr("data-src") || $(img).attr("data-lazy");
    if (!src) return;

    // Only include actual manga page images (from the known CDN or any http image)
    if (!src.startsWith("http")) return;

    pages.push({
      index: pages.length,
      imageUrl: src,
    });
  });

  return pages;
}

registerSource({
  name: "weebcentral",
  displayName: "WeebCentral",
  baseUrl: BASE_URL,
  isNsfw: false,
  getChapterUrl,
  search,
  getSeriesDetail,
  getChapterList,
  getChapterPages,
});
