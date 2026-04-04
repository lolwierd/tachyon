import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  chapter,
  chapterProgress,
  libraryEntry,
  mediaCache,
  readingProgress,
  series,
  seriesTag,
  sourceMapping,
} from "@/lib/db/schema";
import type { Chapter, SeriesDetail } from "@/lib/sources/types";
import { ensureSeriesRecord, getSeriesMapping, type SourceName } from "./shared";

export type LibraryStatus =
  | "reading"
  | "completed"
  | "paused"
  | "dropped"
  | "rereading"
  | "planning";

export interface LibraryEntryRecord {
  seriesId: string;
  sourceSeriesId: string;
  source: string | null;
  title: string;
  coverUrl: string | null;
  status: LibraryStatus;
  addedAt: string | null;
  updatedAt: string | null;
  currentPage: number | null;
  progressUpdatedAt: string | null;
  currentChapterSourceId: string | null;
  currentChapterTitle: string | null;
  totalChapters: number;
  completedChapters: number;
  unreadChapters: number;
  downloadedChapters: number;
  lastCompletedAt: string | null;
  lastCompletedChapterSourceId: string | null;
  lastCompletedChapterTitle: string | null;
  tagIds: string[];
  adult: boolean;
}

export interface UpsertLibraryEntryInput {
  sourceSeriesId: string;
  status: LibraryStatus;
  seriesDetail?: SeriesDetail;
  chapters?: Pick<Chapter, "sourceChapterId" | "chapterNo" | "title">[];
  sourceName?: string;
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function mapRowToEntry(row: {
  seriesId: string;
  sourceSeriesId: string;
  source: string | null;
  title: string;
  coverUrl: string | null;
  status: LibraryStatus;
  addedAt: Date | null;
  updatedAt: Date | null;
  currentPage: number | null;
  progressUpdatedAt: Date | null;
  currentChapterSourceId: string | null;
  currentChapterTitle: string | null;
  totalChapters: number;
  completedChapters: number;
  downloadedChapters: number;
  lastCompletedAt: Date | null;
  lastCompletedChapterSourceId: string | null;
  lastCompletedChapterTitle: string | null;
  tagIds: string[];
  adult: boolean;
}): LibraryEntryRecord {
  return {
    seriesId: row.seriesId,
    sourceSeriesId: row.sourceSeriesId,
    source: row.source,
    title: row.title,
    coverUrl: row.coverUrl,
    status: row.status,
    addedAt: toIsoString(row.addedAt),
    updatedAt: toIsoString(row.updatedAt),
    currentPage: row.currentPage,
    progressUpdatedAt: toIsoString(row.progressUpdatedAt),
    currentChapterSourceId: row.currentChapterSourceId,
    currentChapterTitle: row.currentChapterTitle,
    totalChapters: row.totalChapters,
    completedChapters: row.completedChapters,
    unreadChapters: Math.max(row.totalChapters - row.completedChapters, 0),
    downloadedChapters: row.downloadedChapters,
    lastCompletedAt: toIsoString(row.lastCompletedAt),
    lastCompletedChapterSourceId: row.lastCompletedChapterSourceId,
    lastCompletedChapterTitle: row.lastCompletedChapterTitle,
    tagIds: row.tagIds,
    adult: row.adult,
  };
}

function ensureChapterCatalog(
  seriesId: string,
  chapters: Pick<Chapter, "sourceChapterId" | "chapterNo" | "title">[],
  sourceName: string,
) {
  const now = new Date();

  for (const chapterItem of chapters) {
    const existing = getDb()
      .select({
        id: chapter.id,
      })
      .from(chapter)
      .where(
        and(
          eq(chapter.seriesId, seriesId),
          eq(chapter.source, sourceName),
          eq(chapter.sourceChapterId, chapterItem.sourceChapterId),
        ),
      )
      .get();

    if (existing) {
      continue;
    }

    getDb()
      .insert(chapter)
      .values({
        id: crypto.randomUUID(),
        seriesId,
        source: sourceName,
        sourceChapterId: chapterItem.sourceChapterId,
        chapterNo: chapterItem.chapterNo,
        title: chapterItem.title,
        pageCount: 0,
        sortKey: chapterItem.chapterNo,
        createdAt: now,
      })
      .run();
  }
}

function buildLibraryEntry(baseRow: {
  sourceSeriesId: string;
  source: string | null;
  title: string;
  coverUrl: string | null;
  status: LibraryStatus;
  addedAt: Date | null;
  updatedAt: Date | null;
  currentPage: number | null;
  progressUpdatedAt: Date | null;
  currentChapterSourceId: string | null;
  currentChapterTitle: string | null;
  seriesId: string;
  adult: boolean;
}) {
  const totalChapters = getDb()
    .select({ value: count() })
    .from(chapter)
    .where(eq(chapter.seriesId, baseRow.seriesId))
    .get()?.value ?? 0;

  const completedChapters = getDb()
    .select({ value: count() })
    .from(chapterProgress)
    .where(and(eq(chapterProgress.seriesId, baseRow.seriesId), eq(chapterProgress.completed, true)))
    .get()?.value ?? 0;

  const lastCompletedRow = getDb()
    .select({
      completedAt: chapterProgress.completedAt,
      sourceChapterId: chapter.sourceChapterId,
      title: chapter.title,
    })
    .from(chapterProgress)
    .innerJoin(chapter, eq(chapterProgress.chapterId, chapter.id))
    .where(and(eq(chapterProgress.seriesId, baseRow.seriesId), eq(chapterProgress.completed, true)))
    .orderBy(desc(chapterProgress.completedAt))
    .get();

  const downloadedChapters = getDb()
    .select({ value: count() })
    .from(mediaCache)
    .innerJoin(chapter, eq(mediaCache.chapterId, chapter.id))
    .where(and(eq(chapter.seriesId, baseRow.seriesId), eq(mediaCache.state, "ready")))
    .get()?.value ?? 0;

  const tagIds = getDb()
    .select({ tagId: seriesTag.tagId })
    .from(seriesTag)
    .where(eq(seriesTag.seriesId, baseRow.seriesId))
    .all()
    .map((row) => row.tagId);

  return mapRowToEntry({
    ...baseRow,
    totalChapters,
    completedChapters,
    downloadedChapters,
    lastCompletedAt: lastCompletedRow?.completedAt ?? null,
    lastCompletedChapterSourceId: lastCompletedRow?.sourceChapterId ?? null,
    lastCompletedChapterTitle: lastCompletedRow?.title ?? null,
    tagIds,
    adult: baseRow.adult,
  });
}

export function getLibraryEntry(sourceSeriesId: string, sourceName?: string) {
  const mapping = getSeriesMapping(sourceSeriesId, sourceName);
  if (!mapping) {
    return null;
  }

  const row = getDb()
    .select({
      seriesId: series.id,
      sourceSeriesId: sourceMapping.sourceSeriesId,
      source: sourceMapping.source,
      title: series.title,
      coverUrl: series.coverUrl,
      adult: series.adult,
      status: libraryEntry.status,
      addedAt: libraryEntry.addedAt,
      updatedAt: libraryEntry.updatedAt,
      currentPage: readingProgress.currentPage,
      progressUpdatedAt: readingProgress.updatedAt,
      currentChapterSourceId: chapter.sourceChapterId,
      currentChapterTitle: chapter.title,
    })
    .from(sourceMapping)
    .innerJoin(series, eq(sourceMapping.seriesId, series.id))
    .innerJoin(libraryEntry, eq(libraryEntry.seriesId, series.id))
    .leftJoin(readingProgress, eq(readingProgress.seriesId, series.id))
    .leftJoin(chapter, eq(readingProgress.currentChapterId, chapter.id))
    .where(
      and(
        eq(sourceMapping.source, mapping.source as SourceName),
        eq(sourceMapping.seriesId, mapping.seriesId),
      ),
    )
    .get();

  return row ? buildLibraryEntry({ ...row, adult: row.adult ?? false }) : null;
}

export function setLibraryEntryAdult(sourceSeriesId: string, adult: boolean, sourceName?: string) {
  const mapping = getSeriesMapping(sourceSeriesId, sourceName);
  if (!mapping) {
    throw new Error("Library entry not found");
  }

  const existing = getDb()
    .select({ seriesId: libraryEntry.seriesId })
    .from(libraryEntry)
    .where(eq(libraryEntry.seriesId, mapping.seriesId))
    .get();

  if (!existing) {
    throw new Error("Library entry not found");
  }

  getDb()
    .update(series)
    .set({
      adult,
      updatedAt: new Date(),
    })
    .where(eq(series.id, mapping.seriesId))
    .run();

  const entry = getLibraryEntry(mapping.seriesId, sourceName);
  if (!entry) {
    throw new Error("Library entry not found");
  }

  return entry;
}

export async function upsertLibraryEntry(input: UpsertLibraryEntryInput) {
  const sourceName =
    input.sourceName ?? input.seriesDetail?.source ?? getSeriesMapping(input.sourceSeriesId)?.source;
  if (!sourceName) {
    throw new Error(`Could not resolve source for series ${input.sourceSeriesId}`);
  }

  const seriesId = await ensureSeriesRecord(input.sourceSeriesId, input.seriesDetail, sourceName);
  const now = new Date();

  if (input.chapters && input.chapters.length > 0) {
    ensureChapterCatalog(seriesId, input.chapters, sourceName);
  }

  getDb()
    .insert(libraryEntry)
    .values({
      seriesId,
      status: input.status,
      addedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: libraryEntry.seriesId,
      set: {
        status: input.status,
        updatedAt: now,
      },
    })
    .run();

  return getLibraryEntry(input.sourceSeriesId, sourceName);
}

export function listLibraryEntries(opts?: { includeNsfw?: boolean }) {
  const rows = getDb()
    .select({
      seriesId: series.id,
      sourceSeriesId: sourceMapping.sourceSeriesId,
      source: sourceMapping.source,
      title: series.title,
      coverUrl: series.coverUrl,
      adult: series.adult,
      status: libraryEntry.status,
      addedAt: libraryEntry.addedAt,
      updatedAt: libraryEntry.updatedAt,
      currentPage: readingProgress.currentPage,
      progressUpdatedAt: readingProgress.updatedAt,
      currentChapterSourceId: chapter.sourceChapterId,
      currentChapterTitle: chapter.title,
    })
    .from(libraryEntry)
    .innerJoin(series, eq(libraryEntry.seriesId, series.id))
    .innerJoin(
      sourceMapping,
      eq(sourceMapping.seriesId, series.id),
    )
    .leftJoin(readingProgress, eq(readingProgress.seriesId, series.id))
    .leftJoin(chapter, eq(readingProgress.currentChapterId, chapter.id))
    .orderBy(desc(libraryEntry.updatedAt), desc(libraryEntry.addedAt))
    .all();

  // Deduplicate: a series may have multiple source mappings — keep first per seriesId
  const seen = new Set<string>();
  const deduped = rows.filter((row) => {
    if (seen.has(row.seriesId)) return false;
    seen.add(row.seriesId);
    return true;
  });

  // Apply NSFW filter client-side after dedup
  const filtered = opts?.includeNsfw ? deduped : deduped.filter((row) => !row.adult);

  return filtered.map((row) => buildLibraryEntry({ ...row, adult: row.adult ?? false }));
}

export function removeLibraryEntry(sourceSeriesId: string, sourceName?: string) {
  const mapping = getSeriesMapping(sourceSeriesId, sourceName);
  if (!mapping) return;

  const { seriesId } = mapping;

  // Delete library entry
  getDb().delete(libraryEntry).where(eq(libraryEntry.seriesId, seriesId)).run();

  // Delete tag associations
  getDb().delete(seriesTag).where(eq(seriesTag.seriesId, seriesId)).run();
}
