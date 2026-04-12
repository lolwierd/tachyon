import type {
  SearchResult,
  SeriesDetail,
  Chapter,
  ChapterPage,
  SearchOptions,
} from "./types";

export interface MangaSource {
  name: string;
  displayName: string;
  baseUrl: string;
  isNsfw: boolean;
  requiresFlareSolverr?: boolean;
  getChapterUrl?(chapterSourceId: string): string;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  getSeriesDetail(sourceId: string): Promise<SeriesDetail>;
  getChapterList(sourceId: string): Promise<Chapter[]>;
  getChapterPages(chapterSourceId: string): Promise<ChapterPage[]>;
}

const sources = new Map<string, MangaSource>();

export function registerSource(source: MangaSource) {
  sources.set(source.name, source);
}

export function getSource(name: string): MangaSource | undefined {
  return sources.get(name);
}

export function sourceRequiresFlareSolverr(name: string): boolean {
  const source = getSource(name);
  return Boolean(source?.requiresFlareSolverr);
}

export function getAllSources(): MangaSource[] {
  return Array.from(sources.values());
}

export function getNsfwSources(): MangaSource[] {
  return getAllSources().filter((s) => s.isNsfw);
}

export function getSfwSources(): MangaSource[] {
  return getAllSources().filter((s) => !s.isNsfw);
}

const MAIN_SFW_SOURCES = new Set(["weebcentral", "asurascans", "flamecomics"]);
const MAIN_NSFW_SOURCES = new Set(["manhwa18", "omegascans"]);

export function getMainSources(nsfw: boolean): MangaSource[] {
  const main = nsfw
    ? new Set([...MAIN_SFW_SOURCES, ...MAIN_NSFW_SOURCES])
    : MAIN_SFW_SOURCES;
  return getAllSources().filter((s) => main.has(s.name) && (nsfw || !s.isNsfw));
}

export function getExtraSources(nsfw: boolean): MangaSource[] {
  const main = nsfw
    ? new Set([...MAIN_SFW_SOURCES, ...MAIN_NSFW_SOURCES])
    : MAIN_SFW_SOURCES;
  return getAllSources().filter((s) => !main.has(s.name) && (nsfw || !s.isNsfw));
}
