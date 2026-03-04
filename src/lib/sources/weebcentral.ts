import * as cheerio from "cheerio";
import type {
  SearchResult,
  SeriesDetail,
  Chapter,
  ChapterPage,
  SearchOptions,
} from "./types";

const BASE_URL = "https://weebcentral.com";
const COVER_BASE = "https://temp.compsci88.com/cover/fallback";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_DELAY_MS = 300;

// ---------------------------------------------------------------------------
// Rate-limiting: simple serial queue with 300ms gap between requests
// ---------------------------------------------------------------------------

let lastRequestTime = 0;

async function throttledFetch(
  url: string,
  options?: { htmx?: boolean; method?: string; body?: string; referer?: string },
): Promise<string> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < REQUEST_DELAY_MS) {
    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS - elapsed));
  }

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html",
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

  lastRequestTime = Date.now();
  const res = await fetch(url, {
    method: options?.method || "GET",
    headers,
    body: options?.body,
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(
      `WeebCentral request failed: ${res.status} ${res.statusText} — ${url}`,
    );
  }

  return res.text();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function coverUrl(sourceId: string): string {
  return `${COVER_BASE}/${sourceId}.jpg`;
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

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// getSeriesDetail
// ---------------------------------------------------------------------------

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

  // AniList URL
  let anilistUrl: string | null = null;
  $('a[href*="anilist.co/manga/"]').each((_, a) => {
    anilistUrl = $(a).attr("href") ?? null;
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

// ---------------------------------------------------------------------------
// getChapterList
// ---------------------------------------------------------------------------

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

    chapters.push({
      sourceChapterId: chapterId,
      chapterNo,
      title: text,
    });
  });

  // Source returns newest-first; reverse to ascending (oldest first)
  chapters.reverse();

  return chapters;
}

// ---------------------------------------------------------------------------
// getChapterPages
// ---------------------------------------------------------------------------

export async function getChapterPages(
  chapterSourceId: string,
): Promise<ChapterPage[]> {
  const url = `${BASE_URL}/chapters/${chapterSourceId}/images?is_prev=False&current_page=1&reading_style=long_strip`;
  const html = await throttledFetch(url, { htmx: true });
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
