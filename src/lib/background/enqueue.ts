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
import { getSource } from "@/lib/sources/registry";
import { ensureSeriesRecord, getSeriesMapping as getSharedSeriesMapping } from "@/lib/library/shared";
import "@/lib/sources/init";
import { createRunWithTasks, type RunTrigger } from "@/lib/background/queue";
import { getBackgroundSettings } from "@/lib/background/settings";

export type DownloadScope = "all" | "unread" | "next5" | "next10" | "next50" | "next100";

function dedupeKey(sourceSeriesId: string, sourceChapterId: string) {
  return `download:${sourceSeriesId}:${sourceChapterId}`;
}

function getSeriesMapping(sourceSeriesId: string) {
  return getSharedSeriesMapping(sourceSeriesId);
}

function requireCanonicalSourceSeriesId(seriesId: string) {
  const mapping = getSeriesMapping(seriesId);
  if (!mapping) {
    throw new Error(`Series source not found for ${seriesId}`);
  }
  return mapping.sourceSeriesId;
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
  const mapping = getSeriesMapping(sourceSeriesId);
  if (!mapping) throw new Error(`Series source not found for ${sourceSeriesId}`);
  const canonicalSourceSeriesId = mapping.sourceSeriesId;
  const sourceName = mapping.source;
  const sourceInst = getSource(sourceName);
  if (!sourceInst) throw new Error(`Unknown source: ${sourceName}`);
  const chapterList = await sourceInst.getChapterList(canonicalSourceSeriesId);
  const localSeriesId = await ensureSeriesRecord(canonicalSourceSeriesId, undefined, sourceName);
  const completedIds = getCompletedChapterIds(localSeriesId);
  const downloadedIds = getDownloadedChapterIds(localSeriesId);
  const queuedDedupe = getActiveDedupeKeys(canonicalSourceSeriesId);

  let target = chapterList.filter((ch) => {
    const chapterId = ch.sourceChapterId;
    return !downloadedIds.has(chapterId) && !queuedDedupe.has(dedupeKey(canonicalSourceSeriesId, chapterId));
  });

  if (scope === "unread") {
    target = target.filter((ch) => !completedIds.has(ch.sourceChapterId));
  } else if (scope === "next5" || scope === "next10" || scope === "next50" || scope === "next100") {
    const limit = scope === "next5" ? 5 : scope === "next10" ? 10 : scope === "next50" ? 50 : 100;
    target = target
      .filter((ch) => !completedIds.has(ch.sourceChapterId))
      .slice(0, limit);
  }

  return target.map((ch) => ch.sourceChapterId);
}

export function enqueueDownloadChapters(input: {
  sourceSeriesId: string;
  chapterIds: string[];
  trigger: RunTrigger;
  reason: string;
}) {
  const canonicalSourceSeriesId = requireCanonicalSourceSeriesId(input.sourceSeriesId);
  const dedupe = getActiveDedupeKeys(canonicalSourceSeriesId);
  const uniqueChapterIds = Array.from(new Set(input.chapterIds))
    .filter((chapterId) => !dedupe.has(dedupeKey(canonicalSourceSeriesId, chapterId)));

  return createRunWithTasks({
    kind: "download",
    trigger: input.trigger,
    scope: {
      reason: input.reason,
      sourceSeriesId: canonicalSourceSeriesId,
      chapterIds: uniqueChapterIds,
    },
    tasks: uniqueChapterIds.map((chapterId) => ({
      queue: "download" as const,
      taskType: "download_chapter" as const,
      sourceSeriesId: canonicalSourceSeriesId,
      sourceChapterId: chapterId,
      payload: {},
      priority: 10,
      maxAttempts: 4,
      dedupeKey: dedupeKey(canonicalSourceSeriesId, chapterId),
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
  const canonicalSourceSeriesId = requireCanonicalSourceSeriesId(input.sourceSeriesId);
  return createRunWithTasks({
    kind: "download",
    trigger: input.trigger,
    scope: {
      reason: input.reason,
      sourceSeriesId: canonicalSourceSeriesId,
      keepLastN: input.keepLastN,
    },
    tasks: [
      {
        queue: "download",
        taskType: "delete_read_downloads",
        sourceSeriesId: canonicalSourceSeriesId,
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
    sourceSeriesId: mapping.sourceSeriesId,
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

  const downloaded = getDownloadedChapterIds(mapping.seriesId);

  if (settings.nextNAfterRead > 0) {
    if (downloaded.has(sourceChapterId)) {
      const chapterSourceName = mapping.source;
      const chapters = getDb().select({ sourceChapterId: chapter.sourceChapterId })
        .from(chapter)
        .where(and(eq(chapter.seriesId, mapping.seriesId), eq(chapter.source, chapterSourceName)))
        .orderBy(asc(chapter.sortKey))
        .all()
        .map((row) => row.sourceChapterId);

      const currentIndex = chapters.findIndex((id) => id === sourceChapterId);
      if (currentIndex >= 0) {
        const completed = getCompletedChapterIds(mapping.seriesId);
        const targetIds = chapters
          .slice(currentIndex + 1, currentIndex + 1 + settings.nextNAfterRead)
          .filter((id) => !completed.has(id))
          .filter((id) => !downloaded.has(id));

        if (targetIds.length > 0) {
          enqueueDownloadChapters({
            sourceSeriesId: mapping.sourceSeriesId,
            chapterIds: targetIds,
            trigger: "automation",
            reason: "after_chapter_completed",
          });
        }
      }
    }
  }

  if (settings.autoDeleteReadEnabled && downloaded.has(sourceChapterId)) {
    enqueueDeleteReadDownloads({
      sourceSeriesId: mapping.sourceSeriesId,
      keepLastN: settings.autoDeleteKeepLastN,
      trigger: "automation",
      reason: "after_chapter_completed",
    });
  }
}
