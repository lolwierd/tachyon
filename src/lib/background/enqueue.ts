import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  backgroundTask,
  chapter,
  chapterProgress,
  mediaCache,
  seriesDownloadPolicy,
  sourceMapping,
} from "@/lib/db/schema";
import { getChapterList } from "@/lib/sources/weebcentral";
import { SOURCE, ensureSeriesRecord } from "@/lib/library/shared";
import { createRunWithTasks, type RunTrigger } from "@/lib/background/queue";
import { getBackgroundSettings } from "@/lib/background/settings";

export type DownloadScope = "all" | "unread" | "next50" | "next100";

function dedupeKey(sourceSeriesId: string, sourceChapterId: string) {
  return `download:${sourceSeriesId}:${sourceChapterId}`;
}

function getSeriesMapping(sourceSeriesId: string) {
  return getDb().select({ seriesId: sourceMapping.seriesId })
    .from(sourceMapping)
    .where(and(eq(sourceMapping.source, SOURCE), eq(sourceMapping.sourceSeriesId, sourceSeriesId)))
    .get();
}

function getActiveDedupeKeys(sourceSeriesId: string) {
  const rows = getDb().select({ dedupeKey: backgroundTask.dedupeKey })
    .from(backgroundTask)
    .where(
      and(
        inArray(backgroundTask.state, ["queued", "retry_wait", "running"]),
        eq(backgroundTask.queue, "download"),
        eq(backgroundTask.sourceSeriesId, sourceSeriesId),
      ),
    )
    .all();

  return new Set(rows.map((row) => row.dedupeKey).filter((value): value is string => Boolean(value)));
}

function getDownloadedChapterIds(localSeriesId: string) {
  return new Set(
    getDb().select({ sourceChapterId: chapter.sourceChapterId })
      .from(mediaCache)
      .innerJoin(chapter, eq(mediaCache.chapterId, chapter.id))
      .where(and(eq(chapter.seriesId, localSeriesId), eq(mediaCache.state, "ready")))
      .all()
      .map((row) => row.sourceChapterId),
  );
}

function getCompletedChapterIds(localSeriesId: string) {
  return new Set(
    getDb().select({ sourceChapterId: chapter.sourceChapterId })
      .from(chapterProgress)
      .innerJoin(chapter, eq(chapterProgress.chapterId, chapter.id))
      .where(and(eq(chapterProgress.seriesId, localSeriesId), eq(chapterProgress.completed, true)))
      .all()
      .map((row) => row.sourceChapterId),
  );
}

export async function resolveBulkDownloadChapterIds(sourceSeriesId: string, scope: DownloadScope) {
  const chapterList = await getChapterList(sourceSeriesId);
  const localSeriesId = await ensureSeriesRecord(sourceSeriesId);
  const completedIds = getCompletedChapterIds(localSeriesId);
  const downloadedIds = getDownloadedChapterIds(localSeriesId);
  const queuedDedupe = getActiveDedupeKeys(sourceSeriesId);

  let target = chapterList;

  if (scope === "unread") {
    target = target.filter((ch) => !completedIds.has(ch.sourceChapterId));
  } else if (scope === "next50" || scope === "next100") {
    const limit = scope === "next50" ? 50 : 100;
    target = target
      .filter((ch) => !completedIds.has(ch.sourceChapterId))
      .slice(0, limit);
  }

  return target
    .map((ch) => ch.sourceChapterId)
    .filter((chapterId) => !downloadedIds.has(chapterId))
    .filter((chapterId) => !queuedDedupe.has(dedupeKey(sourceSeriesId, chapterId)));
}

export function enqueueDownloadChapters(input: {
  sourceSeriesId: string;
  chapterIds: string[];
  trigger: RunTrigger;
  reason: string;
}) {
  const dedupe = getActiveDedupeKeys(input.sourceSeriesId);
  const uniqueChapterIds = Array.from(new Set(input.chapterIds))
    .filter((chapterId) => !dedupe.has(dedupeKey(input.sourceSeriesId, chapterId)));

  return createRunWithTasks({
    kind: "download",
    trigger: input.trigger,
    scope: {
      reason: input.reason,
      sourceSeriesId: input.sourceSeriesId,
      chapterIds: uniqueChapterIds,
    },
    tasks: uniqueChapterIds.map((chapterId) => ({
      queue: "download" as const,
      taskType: "download_chapter" as const,
      sourceSeriesId: input.sourceSeriesId,
      sourceChapterId: chapterId,
      payload: {},
      priority: 10,
      maxAttempts: 4,
      dedupeKey: dedupeKey(input.sourceSeriesId, chapterId),
    })),
  });
}

export async function enqueueBulkDownload(input: {
  sourceSeriesId: string;
  scope: DownloadScope;
  trigger: RunTrigger;
}) {
  const chapterIds = await resolveBulkDownloadChapterIds(input.sourceSeriesId, input.scope);
  return enqueueDownloadChapters({
    sourceSeriesId: input.sourceSeriesId,
    chapterIds,
    trigger: input.trigger,
    reason: `bulk:${input.scope}`,
  });
}

export function enqueueSingleChapterDownload(input: {
  sourceSeriesId: string;
  sourceChapterId: string;
  trigger: RunTrigger;
}) {
  return enqueueDownloadChapters({
    sourceSeriesId: input.sourceSeriesId,
    chapterIds: [input.sourceChapterId],
    trigger: input.trigger,
    reason: "single",
  });
}

export function enqueueDeleteReadDownloads(input: {
  sourceSeriesId: string;
  keepLastN: number;
  trigger: RunTrigger;
  reason: string;
}) {
  return createRunWithTasks({
    kind: "download",
    trigger: input.trigger,
    scope: {
      reason: input.reason,
      sourceSeriesId: input.sourceSeriesId,
      keepLastN: input.keepLastN,
    },
    tasks: [
      {
        queue: "download",
        taskType: "delete_read_downloads",
        sourceSeriesId: input.sourceSeriesId,
        payload: {
          keepLastN: input.keepLastN,
        },
        priority: 5,
        maxAttempts: 2,
      },
    ],
  });
}

export function enqueueUpdateRun(input: {
  sourceSeriesIds: string[];
  trigger: RunTrigger;
  reason: string;
  scheduleId?: string;
}) {
  const sourceSeriesIds = Array.from(new Set(input.sourceSeriesIds));

  return createRunWithTasks({
    kind: "update",
    trigger: input.trigger,
    scope: {
      reason: input.reason,
      scheduleId: input.scheduleId ?? null,
      sourceSeriesIds,
    },
    tasks: sourceSeriesIds.map((sourceSeriesId) => ({
      queue: "update" as const,
      taskType: "refresh_series" as const,
      sourceSeriesId,
      payload: {
        scheduleId: input.scheduleId ?? null,
      },
      priority: 5,
      maxAttempts: 3,
      dedupeKey: `refresh:${sourceSeriesId}`,
    })),
  });
}

export function enqueueUpdateForLibrary(reason: string, trigger: RunTrigger = "manual") {
  const rows = getDb().select({ sourceSeriesId: sourceMapping.sourceSeriesId })
    .from(sourceMapping)
    .where(eq(sourceMapping.source, SOURCE))
    .all();

  return enqueueUpdateRun({
    sourceSeriesIds: rows.map((row) => row.sourceSeriesId),
    trigger,
    reason,
  });
}

export function getSeriesPolicy(sourceSeriesId: string) {
  const mapping = getSeriesMapping(sourceSeriesId);
  if (!mapping) {
    return null;
  }

  const policy = getDb().select()
    .from(seriesDownloadPolicy)
    .where(eq(seriesDownloadPolicy.seriesId, mapping.seriesId))
    .get();

  return policy;
}

export function upsertSeriesPolicy(input: {
  sourceSeriesId: string;
  autoDownloadNewEnabled: boolean;
  autoDownloadNewLimit: number;
}) {
  const mapping = getSeriesMapping(input.sourceSeriesId);
  if (!mapping) {
    return null;
  }

  const limit = Math.min(Math.max(Math.trunc(input.autoDownloadNewLimit), 1), 50);
  const timestamp = new Date();
  getDb().insert(seriesDownloadPolicy).values({
    seriesId: mapping.seriesId,
    sourceSeriesId: input.sourceSeriesId,
    autoDownloadNewEnabled: input.autoDownloadNewEnabled,
    autoDownloadNewLimit: limit,
    updatedAt: timestamp,
  }).onConflictDoUpdate({
    target: seriesDownloadPolicy.seriesId,
    set: {
      autoDownloadNewEnabled: input.autoDownloadNewEnabled,
      autoDownloadNewLimit: limit,
      updatedAt: timestamp,
    },
  }).run();

  return getSeriesPolicy(input.sourceSeriesId);
}

export function enqueueAfterChapterCompleted(sourceSeriesId: string, sourceChapterId: string) {
  const settings = getBackgroundSettings();
  const mapping = getSeriesMapping(sourceSeriesId);
  if (!mapping) {
    return;
  }

  if (settings.nextNAfterRead > 0) {
    const chapters = getDb().select({ sourceChapterId: chapter.sourceChapterId })
      .from(chapter)
      .where(and(eq(chapter.seriesId, mapping.seriesId), eq(chapter.source, SOURCE)))
      .orderBy(asc(chapter.sortKey))
      .all()
      .map((row) => row.sourceChapterId);

    const currentIndex = chapters.findIndex((id) => id === sourceChapterId);
    if (currentIndex >= 0) {
      const completed = getCompletedChapterIds(mapping.seriesId);
      const downloaded = getDownloadedChapterIds(mapping.seriesId);
      const targetIds = chapters
        .slice(currentIndex + 1)
        .filter((id) => !completed.has(id))
        .filter((id) => !downloaded.has(id))
        .slice(0, settings.nextNAfterRead);

      if (targetIds.length > 0) {
        enqueueDownloadChapters({
          sourceSeriesId,
          chapterIds: targetIds,
          trigger: "automation",
          reason: "after_chapter_completed",
        });
      }
    }
  }

  if (settings.autoDeleteReadEnabled) {
    enqueueDeleteReadDownloads({
      sourceSeriesId,
      keepLastN: settings.autoDeleteKeepLastN,
      trigger: "automation",
      reason: "after_chapter_completed",
    });
  }
}
