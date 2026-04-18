import type {
  SearchResult,
  SeriesDetail,
  Chapter,
  ChapterPage,
  SearchOptions,
} from "./types";
import { isNsfwEnabled } from "@/lib/server/config";

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

// NSFW-only sources self-register on module import. When NSFW is
// globally disabled via NSFW_ENABLED, we drop the registration so the
// scraper is effectively invisible to the rest of the app: getSource
// returns undefined, background refreshes can't resolve it, and the
// search route can't iterate into it. This avoids a second gate at
// every call site.
export function registerSource(source: MangaSource) {
  if (source.isNsfw && !isNsfwEnabled()) return;
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

// The per-request `nsfw` flag is still honored, but collapsed to false
// when the global kill switch is off. Belt-and-suspenders: NSFW sources
// won't be in the registry anyway, but this also prevents the main-set
// from pretending to include manhwa18/omegascans on a stale request.
export function getMainSources(nsfw: boolean): MangaSource[] {
  const effectiveNsfw = nsfw && isNsfwEnabled();
  const main = effectiveNsfw
    ? new Set([...MAIN_SFW_SOURCES, ...MAIN_NSFW_SOURCES])
    : MAIN_SFW_SOURCES;
  return getAllSources().filter((s) => main.has(s.name) && (effectiveNsfw || !s.isNsfw));
}

export function getExtraSources(nsfw: boolean): MangaSource[] {
  const effectiveNsfw = nsfw && isNsfwEnabled();
  const main = effectiveNsfw
    ? new Set([...MAIN_SFW_SOURCES, ...MAIN_NSFW_SOURCES])
    : MAIN_SFW_SOURCES;
  return getAllSources().filter((s) => !main.has(s.name) && (effectiveNsfw || !s.isNsfw));
}
