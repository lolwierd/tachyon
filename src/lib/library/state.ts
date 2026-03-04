import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  chapter,
  chapterProgress,
  collectionSeries,
  libraryEntry,
  mediaCache,
  readingProgress,
  series,
  seriesTag,
  sourceMapping,
} from "@/lib/db/schema";
import type { Chapter, SeriesDetail } from "@/lib/sources/types";
import { ensureSeriesRecord, SOURCE } from "./shared";

export type LibraryStatus =
  | "reading"
  | "completed"
  | "paused"
  | "dropped"
  | "rereading"
  | "planning";

export interface LibraryEntryRecord {
  sourceSeriesId: string;
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
  collectionIds: string[];
  tagIds: string[];
}

export interface UpsertLibraryEntryInput {
  sourceSeriesId: string;
  status: LibraryStatus;
  seriesDetail?: SeriesDetail;
  chapters?: Pick<Chapter, "sourceChapterId" | "chapterNo" | "title">[];
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function mapRowToEntry(row: {
  sourceSeriesId: string;
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
  collectionIds: string[];
  tagIds: string[];
}): LibraryEntryRecord {
  return {
    sourceSeriesId: row.sourceSeriesId,
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
    collectionIds: row.collectionIds,
    tagIds: row.tagIds,
  };
}

function ensureChapterCatalog(
  seriesId: string,
  chapters: Pick<Chapter, "sourceChapterId" | "chapterNo" | "title">[],
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
          eq(chapter.source, SOURCE),
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
        source: SOURCE,
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
}) {
  const totalChapters = getDb()
    .select({ id: chapter.id })
    .from(chapter)
    .where(and(eq(chapter.seriesId, baseRow.seriesId), eq(chapter.source, SOURCE)))
    .all().length;

  const completedChapters = getDb()
    .select({ chapterId: chapterProgress.chapterId })
    .from(chapterProgress)
    .where(and(eq(chapterProgress.seriesId, baseRow.seriesId), eq(chapterProgress.completed, true)))
    .all().length;

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
    .select({ chapterId: mediaCache.chapterId })
    .from(mediaCache)
    .innerJoin(chapter, eq(mediaCache.chapterId, chapter.id))
    .where(and(eq(chapter.seriesId, baseRow.seriesId), eq(mediaCache.state, "ready")))
    .all().length;

  const collectionIds = getDb()
    .select({ collectionId: collectionSeries.collectionId })
    .from(collectionSeries)
    .where(eq(collectionSeries.seriesId, baseRow.seriesId))
    .all()
    .map((row) => row.collectionId);

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
    collectionIds,
    tagIds,
  });
}

export function getLibraryEntry(sourceSeriesId: string) {
  const row = getDb()
    .select({
      seriesId: series.id,
      sourceSeriesId: sourceMapping.sourceSeriesId,
      title: series.title,
      coverUrl: series.coverUrl,
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
        eq(sourceMapping.source, SOURCE),
        eq(sourceMapping.sourceSeriesId, sourceSeriesId),
      ),
    )
    .get();

  return row ? buildLibraryEntry(row) : null;
}

export async function upsertLibraryEntry(input: UpsertLibraryEntryInput) {
  const seriesId = await ensureSeriesRecord(input.sourceSeriesId, input.seriesDetail);
  const now = new Date();

  if (input.chapters && input.chapters.length > 0) {
    ensureChapterCatalog(seriesId, input.chapters);
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

  return getLibraryEntry(input.sourceSeriesId);
}

export function listLibraryEntries() {
  return getDb()
    .select({
      seriesId: series.id,
      sourceSeriesId: sourceMapping.sourceSeriesId,
      title: series.title,
      coverUrl: series.coverUrl,
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
      and(eq(sourceMapping.seriesId, series.id), eq(sourceMapping.source, SOURCE)),
    )
    .leftJoin(readingProgress, eq(readingProgress.seriesId, series.id))
    .leftJoin(chapter, eq(readingProgress.currentChapterId, chapter.id))
    .orderBy(desc(libraryEntry.updatedAt), desc(libraryEntry.addedAt))
    .all()
    .map(buildLibraryEntry);
}
