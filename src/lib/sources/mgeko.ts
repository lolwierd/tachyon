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
import { parseDateLoose } from "./relative-date";

const BASE_URL = "https://www.mgeko.cc";

const fetcher = createFetcher({
  name: "Mgeko",
  baseUrl: BASE_URL,
  requestDelayMs: 500,
  requestTimeoutMs: 15000,
  retryDelayMs: 1000,
});

export function clearCache() {
  fetcher.clearCache();
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function toAbsoluteUrl(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  try {
    return new URL(trimmed, BASE_URL).toString();
  } catch {
    return "";
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function parseSeriesSlug(href: string): string {
  try {
    const pathname = new URL(href, BASE_URL).pathname;
    const match = pathname.match(/^\/manga\/([^/]+)\/?$/);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}

function parseChapterSlug(href: string): string {
  try {
    const pathname = new URL(href, BASE_URL).pathname;
    const match = pathname.match(/^\/reader\/[^/]+\/([^/]+)\/?$/);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}

function assertSlug(value: string, kind: "series" | "chapter"): string {
  const slug = value.trim();
  if (!slug || slug.includes("/") || slug.includes("?") || slug.includes("#")) {
    throw new Error(`Mgeko: invalid ${kind} slug: "${value}"`);
  }
  return slug;
}

function parseChapterNo(label: string): number {
  const normalized = normalizeText(label);
  const decimal = normalized.match(/(?:^|[-\s])(\d+)\.(\d+)(?=$|[-\s])/);
  if (decimal?.[1] && decimal[2]) {
    return Number.parseFloat(`${decimal[1]}.${decimal[2]}`) || 0;
  }

  // Mgeko sometimes renders fractional chapters with a hyphen because the
  // chapter slug and visible label share the same slugified form, e.g.
  // `179-5-eng-li` means chapter 179.5. Only combine adjacent numeric
  // tokens, so `2-side-story-1` remains chapter 2.
  const hyphenated = normalized.match(/(?:^|[-\s])(\d+)-(\d+)(?=$|[-\s])/);
  if (hyphenated?.[1] && hyphenated[2]) {
    return Number.parseFloat(`${hyphenated[1]}.${hyphenated[2]}`) || 0;
  }

  const integer = normalized.match(/(?:^|[-\s])(\d+)(?=$|[-\s])/);
  if (integer?.[1]) {
    return Number.parseFloat(integer[1]) || 0;
  }

  const fallback = normalized.match(/\d+(?:\.\d+)?/);
  return fallback ? Number.parseFloat(fallback[0]) || 0 : 0;
}

function cleanChapterLabel(label: string): string {
  return normalizeText(label)
    .replace(/^chapter\s+/i, "")
    .replace(/-eng-li$/i, "")
    .trim();
}

function displayChapterLabel(label: string, chapterNo: number): string {
  const cleaned = cleanChapterLabel(label);
  if (/^\d+-\d+$/.test(cleaned)) {
    return String(chapterNo);
  }
  return cleaned || String(chapterNo);
}

function normalizeStatus(value: string): string {
  const normalized = normalizeText(value);
  const lower = normalized.toLowerCase();
  if (lower.includes("ongoing")) return "Ongoing";
  if (lower.includes("complete")) return "Complete";
  if (lower.includes("hiatus")) return "Hiatus";
  if (lower.includes("cancel")) return "Canceled";
  return normalized;
}

function inferType(tags: string[]): string {
  const typeTag = tags.find((tag) => /^(manga|manhwa|manhua)$/i.test(tag));
  if (!typeTag) return "Manga";
  return typeTag.charAt(0).toUpperCase() + typeTag.slice(1).toLowerCase();
}

function extractTags($: cheerio.CheerioAPI): string[] {
  const tags: string[] = [];
  $(".categories li a, .manga-tags .selected-pin").each((_, element) => {
    tags.push($(element).text());
  });
  return unique(tags);
}

function extractAuthors($: cheerio.CheerioAPI): string[] {
  const authors: string[] = [];
  $(".author [itemprop='author'], .author .property-item").each((_, element) => {
    authors.push($(element).text());
  });
  return unique(authors);
}

function extractSearchAuthors(value: string): string[] {
  const authors = normalizeText(value).replace(/^Author\(S\):/i, "").trim();
  if (!authors || /^updating$/i.test(authors)) return [];
  return unique(authors.split(/\s*[,;]\s*/));
}

function parseSearchItem($: cheerio.CheerioAPI, element: unknown): SearchResult | null {
  const item = $(element as never);
  const link = item.find("a[href*='/manga/']").first();
  const sourceId = parseSeriesSlug(link.attr("href") ?? "");
  const title = normalizeText(
    item.find(".novel-title").first().text() || link.attr("title"),
  );
  if (!sourceId || !title) return null;

  const image = item.find("img").first();
  const coverUrl = toAbsoluteUrl(
    image.attr("data-src")
      || image.attr("data-lazy-src")
      || image.attr("src"),
  );

  return {
    sourceId,
    title,
    slug: sourceId,
    coverUrl,
    year: null,
    status: normalizeStatus(item.find(".status").first().text()),
    // Search cards do not expose the work type. Leave it unknown until a
    // metadata filter asks us to enrich the result from the series page.
    type: "",
    authors: extractSearchAuthors(item.find("h6").first().text()),
    tags: [],
    source: "mgeko",
  };
}

const MGEKO_TYPE_VALUES: Record<string, string> = {
  Manga: "manga",
  Manhwa: "manhwa",
  Manhua: "manhua",
};

const MGEKO_GENRES = new Set([
  "action",
  "adventure",
  "comedy",
  "cooking",
  "manga",
  "drama",
  "fantasy",
  "gender bender",
  "harem",
  "historical",
  "horror",
  "isekai",
  "josei",
  "manhua",
  "manhwa",
  "martial arts",
  "mature",
  "mecha",
  "medical",
  "mystery",
  "one shot",
  "psychological",
  "romance",
  "school life",
  "sci fi",
  "seinen",
  "shoujo",
  "shounen",
  "slice of life",
  "sports",
  "supernatural",
  "tragedy",
  "webtoons",
  "ladies",
]);

function slugifyTag(value: string): string {
  return normalizeText(value).toLowerCase().replace(/\s+/g, "-");
}

function hasBrowseFilters(options?: SearchOptions): boolean {
  return Boolean(
    options?.sort
      || options?.status?.length
      || options?.type?.length
      || options?.tags?.length
      || options?.author?.trim()
      || options?.official !== undefined
      || options?.adult !== undefined,
  );
}

type MgekoStatus = NonNullable<SearchOptions["status"]>[number];

function browseStatus(status: MgekoStatus): string {
  switch (status) {
    case "Ongoing": return "ongoing";
    case "Complete": return "completed";
    case "Hiatus": return "hiatus";
    case "Canceled": return "";
    default: return "";
  }
}

function browseSort(options: SearchOptions): string {
  switch (options.sort) {
    case "Recently Added": return "recently_added";
    case "Popularity": return "popular_all_time";
    case "Alphabet": return options.order === "Descending" ? "za" : "az";
    case "Latest Updates": return "latest";
    default: return "latest";
  }
}

function parseBrowseCard($: cheerio.CheerioAPI, element: unknown, options: SearchOptions): SearchResult | null {
  const item = $(element as never);
  const link = item.find("a[href*='/manga/']").first();
  const sourceId = parseSeriesSlug(link.attr("href") ?? "");
  const title = normalizeText(item.find(".comic-card__title").first().text() || link.attr("title"));
  if (!sourceId || !title) return null;

  const image = item.find("img").first();
  const type = options.type?.length === 1
    ? Object.entries(MGEKO_TYPE_VALUES).find(([, value]) => value === options.type?.[0].toLowerCase())?.[0] ?? ""
    : "";
  const status = options.status?.length === 1 ? options.status[0] : "";

  return {
    sourceId,
    title,
    slug: sourceId,
    coverUrl: toAbsoluteUrl(image.attr("data-src") || image.attr("src")),
    year: null,
    status,
    type,
    authors: [],
    tags: [],
    source: "mgeko",
  };
}

function parseBrowsePayload(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return "";
    const resultsHtml = (parsed as { results_html?: unknown }).results_html;
    return typeof resultsHtml === "string" ? resultsHtml : "";
  } catch {
    return "";
  }
}

function buildBrowseUrl(query: string, options: SearchOptions): string | null {
  if (options.official === true || options.adult === true) return null;
  if (options.type?.some((type) => type === "OEL")) return null;
  if ((options.status?.length ?? 0) > 1 || (options.type?.length ?? 0) > 1) return null;

  const params = new URLSearchParams();
  const term = [normalizeText(query), normalizeText(options.author)].filter(Boolean).join(" ");
  if (term) params.set("q", term);

  if (options.status?.length === 1) {
    const status = browseStatus(options.status[0]);
    if (!status) return null;
    params.set("status", status);
  }

  if (options.type?.length === 1) {
    const type = MGEKO_TYPE_VALUES[options.type[0]];
    if (type) params.set("type", type);
  }

  if (options.sort) {
    params.set("sort", browseSort(options));
  }

  const genres = options.tags?.filter((tag) => MGEKO_GENRES.has(normalizeText(tag).toLowerCase())) ?? [];
  const tags = options.tags?.filter((tag) => !MGEKO_GENRES.has(normalizeText(tag).toLowerCase())) ?? [];
  if (genres.length > 0) params.set("include_genres", genres.join(","));
  if (tags.length > 0) params.set("tags", tags.map(slugifyTag).join(","));

  return `${BASE_URL}/browse-comics/data/?${params.toString()}`;
}

async function searchBrowse(query: string, options: SearchOptions): Promise<SearchResult[]> {
  const url = buildBrowseUrl(query, options);
  if (!url) return [];

  const html = parseBrowsePayload(await fetcher.fetch(url));
  if (!html) return [];
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  $("article.comic-card").each((_, element) => {
    const result = parseBrowseCard($, element, options);
    if (result && !results.some((item) => item.sourceId === result.sourceId)) {
      results.push(result);
    }
  });
  return results;
}

function parsePublishedAt($: cheerio.CheerioAPI, element: unknown): number | null {
  const item = $(element as never);
  const datetime = normalizeText(item.find("time").first().attr("datetime"));
  const dateText = (datetime || normalizeText(item.find("time").first().text()))
    .replace(/\b([ap])\.m\./gi, "$1m");
  return parseDateLoose(dateText);
}

function parseChapterSourceId(chapterSourceId: string): { seriesSlug: string; chapterSlug: string } {
  const parts = chapterSourceId.split("/");
  if (parts.length !== 2) {
    throw new Error(`Mgeko: invalid chapterSourceId: "${chapterSourceId}"`);
  }

  return {
    seriesSlug: assertSlug(parts[0] ?? "", "series"),
    chapterSlug: assertSlug(parts[1] ?? "", "chapter"),
  };
}

export async function search(
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  const term = normalizeText(query);
  if (hasBrowseFilters(options)) {
    return searchBrowse(term, options ?? {});
  }

  // Mgeko exposes keyword search and a separate latest-updates page.
  const url = term
    ? `${BASE_URL}/search/?${new URLSearchParams({ search: term }).toString()}`
    : `${BASE_URL}/jumbo/manga/?filter=All`;
  const html = await fetcher.fetch(url);
  const $ = cheerio.load(html);

  const selector = term
    ? "ul.novel-list:not(.chapters) > li.novel-item"
    : "ul.novel-list.chapters > li.novel-item";
  const items = $(selector).length > 0
    ? $(selector)
    : $("ul.novel-list > li.novel-item");

  const results: SearchResult[] = [];
  items.each((_, element) => {
    const result = parseSearchItem($, element);
    if (result && !results.some((item) => item.sourceId === result.sourceId)) {
      results.push(result);
    }
  });
  return results;
}

function getSeriesUrl(sourceSeriesId: string): string {
  const slug = assertSlug(sourceSeriesId, "series");
  return `${BASE_URL}/manga/${encodeURIComponent(slug)}/`;
}

export async function getSeriesDetail(sourceId: string): Promise<SeriesDetail> {
  const slug = assertSlug(sourceId, "series");
  const html = await fetcher.fetch(getSeriesUrl(slug));
  const $ = cheerio.load(html);

  const title = normalizeText(
    $("#novel .novel-title").first().text()
      || $("meta[name='title']").attr("content")
      || $("title").text(),
  );
  if (!title) {
    throw new Error(`Mgeko: series not found: ${sourceId}`);
  }

  const cover = $("#novel .cover img").first();
  const coverUrl = toAbsoluteUrl(
    cover.attr("data-src")
      || cover.attr("data-lazy-src")
      || cover.attr("src")
      || $("meta[property='og:image']").attr("content"),
  );
  const tags = extractTags($);
  const status = normalizeStatus(
    $(".header-stats > span").filter((_, element) =>
      normalizeText($(element).find("small").text()).toLowerCase() === "status",
    ).find("strong").first().text(),
  );
  const description = normalizeText(
    $("#info .description").first().text()
      || $("meta[name='description']").attr("content"),
  );

  return {
    sourceId: slug,
    title,
    slug,
    coverUrl,
    description,
    authors: extractAuthors($),
    tags,
    type: inferType(tags),
    status,
    year: null,
    isAdult: false,
    isOfficial: false,
    anilistUrl: null,
    relatedSeries: [],
  };
}

export async function getChapterList(sourceId: string): Promise<Chapter[]> {
  const slug = assertSlug(sourceId, "series");
  const html = await fetcher.fetch(
    `${BASE_URL}/manga/${encodeURIComponent(slug)}/all-chapters/`,
  );
  const $ = cheerio.load(html);
  const chapters: Chapter[] = [];

  $(".chapter-list li").each((_, element) => {
    const item = $(element);
    const anchor = item.find("a[href*='/reader/']").first();
    const chapterSlug = parseChapterSlug(anchor.attr("href") ?? "");
    if (!chapterSlug) return;

    const rawLabel = normalizeText(
      item.find(".chapter-title").first().text()
        || anchor.attr("title")?.replace(/^Chapter\s+/i, "")
        || chapterSlug,
    );
    const label = cleanChapterLabel(rawLabel);
    const chapterNo = parseChapterNo(label);
    chapters.push({
      sourceChapterId: `${slug}/${chapterSlug}`,
      chapterNo,
      title: `Chapter ${displayChapterLabel(label, chapterNo)}`,
      publishedAt: parsePublishedAt($, element),
    });
  });

  return chapters.sort((left, right) => left.chapterNo - right.chapterNo);
}

export async function getChapterPages(chapterSourceId: string): Promise<ChapterPage[]> {
  const { chapterSlug } = parseChapterSourceId(chapterSourceId);
  const html = await fetcher.fetch(
    `${BASE_URL}/reader/en/${encodeURIComponent(chapterSlug)}/`,
  );
  const $ = cheerio.load(html);
  const pages: ChapterPage[] = [];

  $("#chapter-reader img").each((_, element) => {
    const imageUrl = toAbsoluteUrl(
      $(element).attr("data-src")
        || $(element).attr("data-lazy-src")
        || $(element).attr("src"),
    );
    if (
      !/^https?:\/\//i.test(imageUrl)
      || /credits-mgeko\.png$/i.test(imageUrl)
      || /\/static\//i.test(imageUrl)
    ) return;

    pages.push({ index: pages.length, imageUrl });
  });

  return pages;
}

function getChapterUrl(chapterSourceId: string): string {
  const { chapterSlug } = parseChapterSourceId(chapterSourceId);
  return `${BASE_URL}/reader/en/${encodeURIComponent(chapterSlug)}/`;
}

registerSource({
  name: "mgeko",
  displayName: "Mgeko",
  baseUrl: BASE_URL,
  isNsfw: false,
  getSeriesUrl,
  getChapterUrl,
  search,
  getSeriesDetail,
  getChapterList,
  getChapterPages,
});
