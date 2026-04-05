import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  chapter,
  chapterProgress,
  readingProgress,
  seriesPreferences,
} from "@/lib/db/schema";
import { logActivityEvent } from "@/lib/memory/state";
import { getSeriesMapping, type SourceName } from "@/lib/library/shared";
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
  updatedAt?: string | Date;
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

function normalizeSavedAt(value: string | Date | undefined, fallback: Date) {
  if (!value) {
    return fallback;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function isIncomingProgressStale(existingUpdatedAt: Date | null | undefined, incomingUpdatedAt: Date) {
  return existingUpdatedAt != null && existingUpdatedAt.getTime() > incomingUpdatedAt.getTime();
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
  const receivedAt = new Date();
  const savedAt = normalizeSavedAt(input.updatedAt, receivedAt);
  const mapping = getSeriesMapping(input.sourceSeriesId, input.sourceName);
  if (!mapping) {
    throw new Error(`Series source not found for ${input.sourceSeriesId}`);
  }

  const sourceName = mapping.source;
  const localSeriesId = mapping.seriesId;
  const sourceSeriesId = mapping.sourceSeriesId;
  const result = getDb().transaction((tx) => {
    let chapterRecord = tx
      .select({
        id: chapter.id,
        pageCount: chapter.pageCount,
      })
      .from(chapter)
      .where(
        and(
          eq(chapter.seriesId, localSeriesId),
          eq(chapter.source, sourceName as SourceName),
          eq(chapter.sourceChapterId, input.sourceChapterId),
        ),
      )
      .get();

    if (!chapterRecord) {
      chapterRecord = {
        id: crypto.randomUUID(),
        pageCount,
      };

      const inserted = tx.insert(chapter).values({
        id: chapterRecord.id,
        seriesId: localSeriesId,
        source: sourceName as SourceName,
        sourceChapterId: input.sourceChapterId,
        chapterNo: input.chapterNo ?? 0,
        title: input.chapterTitle ?? `Chapter ${input.chapterNo ?? "?"}`,
        pageCount,
        sortKey: input.chapterNo ?? 0,
        createdAt: receivedAt,
      }).onConflictDoNothing({
        target: [chapter.seriesId, chapter.source, chapter.sourceChapterId],
      }).run();

      if (inserted.changes === 0) {
        chapterRecord = tx
          .select({
            id: chapter.id,
            pageCount: chapter.pageCount,
          })
          .from(chapter)
          .where(
            and(
              eq(chapter.seriesId, localSeriesId),
              eq(chapter.source, sourceName as SourceName),
              eq(chapter.sourceChapterId, input.sourceChapterId),
            ),
          )
          .get();
      }
    } else if (pageCount > 0 && chapterRecord.pageCount !== pageCount) {
      tx.update(chapter)
        .set({
          pageCount,
        })
        .where(eq(chapter.id, chapterRecord.id))
        .run();
    }

    if (!chapterRecord) {
      throw new Error(`Failed to resolve chapter record for ${input.sourceChapterId}`);
    }

    const existingProgress = tx
      .select({
        lastPage: chapterProgress.lastPage,
        completed: chapterProgress.completed,
        completedAt: chapterProgress.completedAt,
        startedAt: chapterProgress.startedAt,
        updatedAt: chapterProgress.updatedAt,
      })
      .from(chapterProgress)
      .where(eq(chapterProgress.chapterId, chapterRecord.id))
      .get();

    const existingSeriesProgress = tx
      .select({
        currentChapterId: readingProgress.currentChapterId,
        currentPage: readingProgress.currentPage,
        updatedAt: readingProgress.updatedAt,
      })
      .from(readingProgress)
      .where(eq(readingProgress.seriesId, localSeriesId))
      .get();

    const chapterProgressIsStale = isIncomingProgressStale(existingProgress?.updatedAt, savedAt);
    const reachedFinalPage = currentPage >= pageCount - 1;
    let persistedPage = existingProgress?.lastPage ?? currentPage;
    let persistedCompleted = existingProgress?.completed ?? false;
    let pageChanged = false;
    let completionChanged = false;

    if (!chapterProgressIsStale) {
      persistedCompleted = Boolean(existingProgress?.completed) || reachedFinalPage;
      const completedAt = persistedCompleted
        ? existingProgress?.completedAt ?? savedAt
        : null;

      tx.insert(chapterProgress).values({
        chapterId: chapterRecord.id,
        seriesId: localSeriesId,
        lastPage: currentPage,
        completed: persistedCompleted,
        startedAt: existingProgress?.startedAt ?? savedAt,
        completedAt,
        updatedAt: savedAt,
      }).onConflictDoUpdate({
        target: chapterProgress.chapterId,
        set: {
          lastPage: currentPage,
          completed: persistedCompleted,
          completedAt,
          updatedAt: savedAt,
        },
      }).run();

      persistedPage = currentPage;
      pageChanged = existingProgress?.lastPage !== currentPage;
      completionChanged = !existingProgress?.completed && persistedCompleted;
    }

    if (!isIncomingProgressStale(existingSeriesProgress?.updatedAt, savedAt)) {
      tx.insert(readingProgress).values({
        seriesId: localSeriesId,
        currentChapterId: chapterRecord.id,
        currentPage,
        updatedAt: savedAt,
      }).onConflictDoUpdate({
        target: readingProgress.seriesId,
        set: {
          currentChapterId: chapterRecord.id,
          currentPage,
          updatedAt: savedAt,
        },
      }).run();
    }

    return {
      localChapterId: chapterRecord.id,
      pageChanged,
      completionChanged,
      persistedPage,
      persistedCompleted,
    };
  });

  if (result.pageChanged || result.completionChanged) {
    logActivityEvent({
      type: result.completionChanged ? "chapter_completed" : "chapter_progress",
      seriesId: localSeriesId,
      chapterId: result.localChapterId,
      payload: {
        sourceSeriesId,
        sourceChapterId: input.sourceChapterId,
        currentPage: result.persistedPage,
        pageCount,
        completed: result.persistedCompleted,
      },
    });
  }

  if (result.completionChanged) {
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
