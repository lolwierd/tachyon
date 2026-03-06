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

export function getAllSources(): MangaSource[] {
  return Array.from(sources.values());
}

export function getNsfwSources(): MangaSource[] {
  return getAllSources().filter((s) => s.isNsfw);
}

export function getSfwSources(): MangaSource[] {
  return getAllSources().filter((s) => !s.isNsfw);
}
