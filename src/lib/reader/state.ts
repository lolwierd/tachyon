import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  chapter,
  chapterProgress,
  readingProgress,
  series,
  seriesPreferences,
  sourceMapping,
} from "@/lib/db/schema";
import { logActivityEvent } from "@/lib/memory/state";
import { getChapterList, getSeriesDetail } from "@/lib/sources/weebcentral";
import type { Chapter, SeriesDetail } from "@/lib/sources/types";

const SOURCE = "weebcentral" as const;

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
  sourceChapterId: string;
  chapterTitle?: string;
  chapterNo?: number;
  pageCount: number;
  currentPage: number;
  completed?: boolean;
}

export interface UpdateReaderPreferencesInput {
  sourceSeriesId: string;
  readingDirection: ReadingDirection;
  fitMode: FitMode;
}

function normalizeStatus(status: string | null | undefined) {
  switch (status?.toLowerCase()) {
    case "ongoing":
      return "ongoing" as const;
    case "complete":
    case "completed":
      return "complete" as const;
    case "hiatus":
      return "hiatus" as const;
    case "canceled":
    case "cancelled":
      return "canceled" as const;
    default:
      return null;
  }
}

function normalizeContentType(type: string | null | undefined) {
  switch (type?.toLowerCase()) {
    case "manga":
      return "manga" as const;
    case "manhwa":
      return "manhwa" as const;
    case "manhua":
      return "manhua" as const;
    case "oel":
      return "oel" as const;
    default:
      return null;
  }
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

function getSeriesMapping(sourceSeriesId: string) {
  return getDb()
    .select({
      seriesId: sourceMapping.seriesId,
    })
    .from(sourceMapping)
    .where(
      and(
        eq(sourceMapping.source, SOURCE),
        eq(sourceMapping.sourceSeriesId, sourceSeriesId),
      ),
    )
    .get();
}

async function ensureSeriesRecord(
  sourceSeriesId: string,
  detail?: SeriesDetail,
) {
  const existing = getSeriesMapping(sourceSeriesId);
  if (existing) {
    return existing.seriesId;
  }

  const remoteDetail = detail ?? await getSeriesDetail(sourceSeriesId);
  const seriesId = crypto.randomUUID();

  getDb().insert(series).values({
    id: seriesId,
    title: remoteDetail.title,
    description: remoteDetail.description,
    coverUrl: remoteDetail.coverUrl,
    status: normalizeStatus(remoteDetail.status),
    contentType: normalizeContentType(remoteDetail.type),
    year: remoteDetail.year,
    adult: remoteDetail.isAdult,
    updatedAt: new Date(),
  }).run();

  getDb().insert(sourceMapping).values({
    id: crypto.randomUUID(),
    seriesId,
    source: SOURCE,
    sourceSeriesId,
    sourceUrl: `https://weebcentral.com/series/${sourceSeriesId}/`,
  }).run();

  return seriesId;
}

async function ensureChapterRecord(
  seriesId: string,
  sourceChapterId: string,
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
        eq(chapter.source, SOURCE),
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
    const remoteChapters = await getChapterListForSeries(seriesId);
    remoteChapter = remoteChapters.find((item) => item.sourceChapterId === sourceChapterId);
  }

  const chapterId = crypto.randomUUID();
  const chapterNo = remoteChapter?.chapterNo ?? 0;

  getDb().insert(chapter).values({
    id: chapterId,
    seriesId,
    source: SOURCE,
    sourceChapterId,
    chapterNo,
    title: remoteChapter?.title ?? `Chapter ${chapterNo || "?"}`,
    pageCount: chapterMeta?.pageCount ?? 0,
    sortKey: chapterNo,
    createdAt: new Date(),
  }).run();

  return chapterId;
}

async function getChapterListForSeries(seriesId: string) {
  const mapping = getDb()
    .select({ sourceSeriesId: sourceMapping.sourceSeriesId })
    .from(sourceMapping)
    .where(and(eq(sourceMapping.seriesId, seriesId), eq(sourceMapping.source, SOURCE)))
    .get();

  if (!mapping) {
    return [];
  }

  return getChapterList(mapping.sourceSeriesId);
}

export function getReaderState(
  sourceSeriesId: string,
  sourceChapterId: string,
): ReaderState {
  const mapping = getSeriesMapping(sourceSeriesId);
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
        eq(chapter.source, SOURCE),
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
  const completed = input.completed ?? currentPage >= pageCount - 1;
  const now = new Date();
  const localSeriesId = await ensureSeriesRecord(input.sourceSeriesId);
  const localChapterId = await ensureChapterRecord(localSeriesId, input.sourceChapterId, {
    chapterNo: input.chapterNo ?? 0,
    title: input.chapterTitle ?? `Chapter ${input.chapterNo ?? "?"}`,
    pageCount,
  });

  const existingProgress = getDb()
    .select({
      lastPage: chapterProgress.lastPage,
      completed: chapterProgress.completed,
    })
    .from(chapterProgress)
    .where(eq(chapterProgress.chapterId, localChapterId))
    .get();

  getDb().insert(chapterProgress).values({
    chapterId: localChapterId,
    seriesId: localSeriesId,
    lastPage: currentPage,
    completed,
    startedAt: now,
    completedAt: completed ? now : null,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: chapterProgress.chapterId,
    set: {
      lastPage: currentPage,
      completed,
      completedAt: completed ? now : null,
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
        sourceSeriesId: input.sourceSeriesId,
        sourceChapterId: input.sourceChapterId,
        currentPage,
        pageCount,
        completed,
      },
    });
  }

  return getReaderState(input.sourceSeriesId, input.sourceChapterId);
}

export async function updateReaderPreferences(input: UpdateReaderPreferencesInput) {
  const localSeriesId = await ensureSeriesRecord(input.sourceSeriesId);
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
