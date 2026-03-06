import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  chapter,
  chapterProgress,
  readingProgress,
  seriesPreferences,
  sourceMapping,
} from "@/lib/db/schema";
import { logActivityEvent } from "@/lib/memory/state";
import { getSource } from "@/lib/sources/registry";
import { getSeriesMapping, type SourceName } from "@/lib/library/shared";
import type { Chapter } from "@/lib/sources/types";
import { enqueueAfterChapterCompleted } from "@/lib/background/enqueue";

export type ReadingDirection = "vertical" | "ltr" | "rtl";
export type FitMode = "width" | "height" | "original";

export interface ReaderState {
  preferences: {
    readingDirection: ReadingDirection;
    fitMode: FitMode;
  };
  progress: {
    currentPage: number;
    completed: boolean;
    updatedAt: string | null;
  };
  seriesProgress: {
    currentChapterId: string | null;
    currentPage: number;
    updatedAt: string | null;
  } | null;
}

export interface SaveReaderProgressInput {
  sourceSeriesId: string;
  sourceName?: string;
  sourceChapterId: string;
  chapterTitle?: string;
  chapterNo?: number;
  pageCount: number;
  currentPage: number;
  /**
   * Deprecated: completion is derived from reaching the final page,
   * and remains true once completed.
   */
  completed?: boolean;
}

export interface UpdateReaderPreferencesInput {
  sourceSeriesId: string;
  sourceName?: string;
  readingDirection: ReadingDirection;
  fitMode: FitMode;
}

export function clearSeriesReadingProgress(sourceSeriesId: string, sourceName?: string) {
  const mapping = getSeriesMapping(sourceSeriesId, sourceName);
  if (!mapping) {
    return false;
  }

  getDb()
    .delete(readingProgress)
    .where(eq(readingProgress.seriesId, mapping.seriesId))
    .run();

  return true;
}

function normalizeReadingDirection(value: string | null | undefined): ReadingDirection {
  switch (value) {
    case "ltr":
    case "rtl":
      return value;
    default:
      return "vertical";
  }
}

function normalizeFitMode(value: string | null | undefined): FitMode {
  switch (value) {
    case "height":
    case "original":
      return value;
    default:
      return "width";
  }
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function clampPage(currentPage: number, pageCount: number) {
  const maxPage = Math.max(pageCount - 1, 0);
  return Math.min(Math.max(currentPage, 0), maxPage);
}

async function ensureChapterRecord(
  seriesId: string,
  sourceChapterId: string,
  sourceName: string,
  chapterMeta?: Pick<Chapter, "chapterNo" | "title"> & { pageCount?: number },
) {
  const existing = getDb()
    .select({
      id: chapter.id,
      pageCount: chapter.pageCount,
    })
    .from(chapter)
    .where(
      and(
        eq(chapter.seriesId, seriesId),
        eq(chapter.source, sourceName as SourceName),
        eq(chapter.sourceChapterId, sourceChapterId),
      ),
    )
    .get();

  if (existing) {
    if (
      chapterMeta?.pageCount != null &&
      chapterMeta.pageCount > 0 &&
      existing.pageCount !== chapterMeta.pageCount
    ) {
      getDb().update(chapter)
        .set({
          pageCount: chapterMeta.pageCount,
        })
        .where(eq(chapter.id, existing.id))
        .run();
    }

    return existing.id;
  }

  let remoteChapter = chapterMeta;
  if (!remoteChapter) {
    const remoteChapters = await getChapterListForSeries(seriesId, sourceName);
    remoteChapter = remoteChapters.find((item) => item.sourceChapterId === sourceChapterId);
  }

  const chapterId = crypto.randomUUID();
  const chapterNo = remoteChapter?.chapterNo ?? 0;

  getDb().insert(chapter).values({
    id: chapterId,
    seriesId,
    source: sourceName as SourceName,
    sourceChapterId,
    chapterNo,
    title: remoteChapter?.title ?? `Chapter ${chapterNo || "?"}`,
    pageCount: chapterMeta?.pageCount ?? 0,
    sortKey: chapterNo,
    createdAt: new Date(),
  }).run();

  return chapterId;
}

async function getChapterListForSeries(seriesId: string, sourceName: string) {
  const mapping = getDb()
    .select({ sourceSeriesId: sourceMapping.sourceSeriesId })
    .from(sourceMapping)
    .where(and(eq(sourceMapping.seriesId, seriesId), eq(sourceMapping.source, sourceName as SourceName)))
    .get();

  if (!mapping) return [];

  const source = getSource(sourceName);
  if (!source) return [];

  return source.getChapterList(mapping.sourceSeriesId);
}

export function getReaderState(
  sourceSeriesId: string,
  sourceChapterId: string,
  sourceName?: string,
): ReaderState {
  const mapping = getSeriesMapping(sourceSeriesId, sourceName);
  if (!mapping) {
    return {
      preferences: {
        readingDirection: "vertical",
        fitMode: "width",
      },
      progress: {
        currentPage: 0,
        completed: false,
        updatedAt: null,
      },
      seriesProgress: null,
    };
  }

  const preferencesRow = getDb()
    .select()
    .from(seriesPreferences)
    .where(eq(seriesPreferences.seriesId, mapping.seriesId))
    .get();

  const chapterRow = getDb()
    .select({
      id: chapter.id,
    })
    .from(chapter)
    .where(
      and(
        eq(chapter.seriesId, mapping.seriesId),
        eq(chapter.source, mapping.source),
        eq(chapter.sourceChapterId, sourceChapterId),
      ),
    )
    .get();

  const chapterProgressRow = chapterRow
    ? getDb().select().from(chapterProgress).where(eq(chapterProgress.chapterId, chapterRow.id)).get()
    : null;

  const seriesProgressRow = getDb()
    .select({
      currentPage: readingProgress.currentPage,
      updatedAt: readingProgress.updatedAt,
      sourceChapterId: chapter.sourceChapterId,
    })
    .from(readingProgress)
    .leftJoin(chapter, eq(readingProgress.currentChapterId, chapter.id))
    .where(eq(readingProgress.seriesId, mapping.seriesId))
    .get();

  return {
    preferences: {
      readingDirection: normalizeReadingDirection(preferencesRow?.readingDirection),
      fitMode: normalizeFitMode(preferencesRow?.fitMode),
    },
    progress: {
      currentPage: chapterProgressRow?.lastPage ?? 0,
      completed: chapterProgressRow?.completed ?? false,
      updatedAt: toIsoString(chapterProgressRow?.updatedAt),
    },
    seriesProgress: seriesProgressRow
      ? {
        currentChapterId: seriesProgressRow.sourceChapterId ?? null,
        currentPage: seriesProgressRow.currentPage ?? 0,
        updatedAt: toIsoString(seriesProgressRow.updatedAt),
      }
      : null,
  };
}

export async function saveReaderProgress(input: SaveReaderProgressInput) {
  const pageCount = Math.max(input.pageCount, 1);
  const currentPage = clampPage(input.currentPage, pageCount);
  const now = new Date();
  const mapping = getSeriesMapping(input.sourceSeriesId, input.sourceName);
  if (!mapping) {
    throw new Error(`Series source not found for ${input.sourceSeriesId}`);
  }

  const sourceName = mapping.source;
  const localSeriesId = mapping.seriesId;
  const sourceSeriesId = mapping.sourceSeriesId;
  const localChapterId = await ensureChapterRecord(localSeriesId, input.sourceChapterId, sourceName, {
    chapterNo: input.chapterNo ?? 0,
    title: input.chapterTitle ?? `Chapter ${input.chapterNo ?? "?"}`,
    pageCount,
  });

  const existingProgress = getDb()
    .select({
      lastPage: chapterProgress.lastPage,
      completed: chapterProgress.completed,
      completedAt: chapterProgress.completedAt,
    })
    .from(chapterProgress)
    .where(eq(chapterProgress.chapterId, localChapterId))
    .get();

  const reachedFinalPage = currentPage >= pageCount - 1;
  const completed = Boolean(existingProgress?.completed) || reachedFinalPage;
  const completedAt = completed
    ? existingProgress?.completedAt ?? now
    : null;

  getDb().insert(chapterProgress).values({
    chapterId: localChapterId,
    seriesId: localSeriesId,
    lastPage: currentPage,
    completed,
    startedAt: now,
    completedAt,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: chapterProgress.chapterId,
    set: {
      lastPage: currentPage,
      completed,
      completedAt,
      updatedAt: now,
    },
  }).run();

  getDb().insert(readingProgress).values({
    seriesId: localSeriesId,
    currentChapterId: localChapterId,
    currentPage,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: readingProgress.seriesId,
    set: {
      currentChapterId: localChapterId,
      currentPage,
      updatedAt: now,
    },
  }).run();

  const pageChanged = existingProgress?.lastPage !== currentPage;
  const completionChanged = !existingProgress?.completed && completed;
  if (!existingProgress || pageChanged || completionChanged) {
    logActivityEvent({
      type: completionChanged ? "chapter_completed" : "chapter_progress",
      seriesId: localSeriesId,
      chapterId: localChapterId,
      payload: {
        sourceSeriesId,
        sourceChapterId: input.sourceChapterId,
        currentPage,
        pageCount,
        completed,
      },
    });
  }

  if (completionChanged) {
    enqueueAfterChapterCompleted(sourceSeriesId, input.sourceChapterId);
  }

  return getReaderState(input.sourceSeriesId, input.sourceChapterId, input.sourceName);
}

export async function updateReaderPreferences(input: UpdateReaderPreferencesInput) {
  const mapping = getSeriesMapping(input.sourceSeriesId, input.sourceName);
  if (!mapping) {
    throw new Error(`Series source not found for ${input.sourceSeriesId}`);
  }

  const localSeriesId = mapping.seriesId;
  const now = new Date();

  getDb().insert(seriesPreferences).values({
    seriesId: localSeriesId,
    readingDirection: input.readingDirection,
    fitMode: input.fitMode,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: seriesPreferences.seriesId,
    set: {
      readingDirection: input.readingDirection,
      fitMode: input.fitMode,
      updatedAt: now,
    },
  }).run();

  return {
    readingDirection: input.readingDirection,
    fitMode: input.fitMode,
  };
}
