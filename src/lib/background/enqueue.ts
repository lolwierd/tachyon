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

function dedupeKey(sourceName: string, sourceSeriesId: string, sourceChapterId: string) {
  return `download:${sourceName}:${sourceSeriesId}:${sourceChapterId}`;
}

function getSeriesMapping(sourceSeriesId: string, sourceName?: string | null) {
  return getSharedSeriesMapping(sourceSeriesId, sourceName ?? undefined);
}

function requireSeriesMapping(seriesId: string, sourceName?: string | null) {
  const mapping = getSeriesMapping(seriesId, sourceName);
  if (!mapping) {
    throw new Error(`Series source not found for ${seriesId}`);
  }
  return mapping;
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

export async function resolveBulkDownloadChapterIds(
  sourceSeriesId: string,
  scope: DownloadScope,
  sourceName?: string | null,
) {
  const mapping = requireSeriesMapping(sourceSeriesId, sourceName);
  if (!mapping) throw new Error(`Series source not found for ${sourceSeriesId}`);
  const canonicalSourceSeriesId = mapping.sourceSeriesId;
  const mappingSourceName = mapping.source;
  const sourceInst = getSource(mappingSourceName);
  if (!sourceInst) throw new Error(`Unknown source: ${mappingSourceName}`);
  const rawChapterList = await sourceInst.getChapterList(canonicalSourceSeriesId);
  // Sort ascending so "next N" always starts from the earliest unread chapter
  const chapterList = [...rawChapterList].sort((a, b) => a.chapterNo - b.chapterNo);
  const localSeriesId = await ensureSeriesRecord(canonicalSourceSeriesId, undefined, mappingSourceName);
  const completedIds = getCompletedChapterIds(localSeriesId);
  const downloadedIds = getDownloadedChapterIds(localSeriesId);
  const queuedDedupe = getActiveDedupeKeys(canonicalSourceSeriesId);

  let target = chapterList.filter((ch) => {
    const chapterId = ch.sourceChapterId;
    return !downloadedIds.has(chapterId)
      && !queuedDedupe.has(dedupeKey(mapping.source, canonicalSourceSeriesId, chapterId));
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
  sourceName?: string | null;
  chapterIds: string[];
  trigger: RunTrigger;
  reason: string;
}) {
  const mapping = requireSeriesMapping(input.sourceSeriesId, input.sourceName);
  const canonicalSourceSeriesId = mapping.sourceSeriesId;
  const canonicalSourceName = mapping.source;
  const dedupe = getActiveDedupeKeys(canonicalSourceSeriesId);
  const uniqueChapterIds = Array.from(new Set(input.chapterIds))
    .filter((chapterId) => !dedupe.has(dedupeKey(canonicalSourceName, canonicalSourceSeriesId, chapterId)));

  return createRunWithTasks({
    kind: "download",
    trigger: input.trigger,
    scope: {
      reason: input.reason,
      source: canonicalSourceName,
      sourceSeriesId: canonicalSourceSeriesId,
      chapterIds: uniqueChapterIds,
    },
    tasks: uniqueChapterIds.map((chapterId) => ({
      queue: "download" as const,
      taskType: "download_chapter" as const,
      sourceSeriesId: canonicalSourceSeriesId,
      sourceChapterId: chapterId,
      payload: { source: canonicalSourceName },
      priority: 10,
      maxAttempts: 4,
      dedupeKey: dedupeKey(canonicalSourceName, canonicalSourceSeriesId, chapterId),
    })),
  });
}

export async function enqueueBulkDownload(input: {
  sourceSeriesId: string;
  sourceName?: string | null;
  scope: DownloadScope;
  trigger: RunTrigger;
}) {
  const chapterIds = await resolveBulkDownloadChapterIds(input.sourceSeriesId, input.scope, input.sourceName);
  return enqueueDownloadChapters({
    sourceSeriesId: input.sourceSeriesId,
    sourceName: input.sourceName,
    chapterIds,
    trigger: input.trigger,
    reason: `bulk:${input.scope}`,
  });
}

export function enqueueSingleChapterDownload(input: {
  sourceSeriesId: string;
  sourceName?: string | null;
  sourceChapterId: string;
  trigger: RunTrigger;
}) {
  return enqueueDownloadChapters({
    sourceSeriesId: input.sourceSeriesId,
    sourceName: input.sourceName,
    chapterIds: [input.sourceChapterId],
    trigger: input.trigger,
    reason: "single",
  });
}

export function enqueueDeleteReadDownloads(input: {
  sourceSeriesId: string;
  sourceName?: string | null;
  keepLastN: number;
  trigger: RunTrigger;
  reason: string;
}) {
  const mapping = requireSeriesMapping(input.sourceSeriesId, input.sourceName);
  const canonicalSourceSeriesId = mapping.sourceSeriesId;
  return createRunWithTasks({
    kind: "download",
    trigger: input.trigger,
    scope: {
      reason: input.reason,
      source: mapping.source,
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
          source: mapping.source,
        },
        priority: 5,
        maxAttempts: 2,
      },
    ],
  });
}

export interface UpdateRunEntry {
  sourceSeriesId: string;
  source: string;
}

export function enqueueUpdateRun(input: {
  entries: UpdateRunEntry[];
  trigger: RunTrigger;
  reason: string;
  scheduleId?: string;
}) {
  const seen = new Set<string>();
  const entries: UpdateRunEntry[] = [];
  for (const entry of input.entries) {
    const key = `${entry.source}:${entry.sourceSeriesId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }

  return createRunWithTasks({
    kind: "update",
    trigger: input.trigger,
    scope: {
      reason: input.reason,
      scheduleId: input.scheduleId ?? null,
      entries,
    },
    tasks: entries.map(({ sourceSeriesId, source }) => ({
      queue: "update" as const,
      taskType: "refresh_series" as const,
      sourceSeriesId,
      payload: {
        scheduleId: input.scheduleId ?? null,
        source,
      },
      priority: 5,
      // Source adapters already retry transient requests. Retrying the whole
      // refresh task multiplies an unreachable source into minutes of work.
      maxAttempts: 1,
      dedupeKey: `refresh:${source}:${sourceSeriesId}`,
    })),
  });
}

export function enqueueUpdateForLibrary(reason: string, trigger: RunTrigger = "manual") {
  const rows = getDb().select({
    sourceSeriesId: sourceMapping.sourceSeriesId,
    source: sourceMapping.source,
  })
    .from(sourceMapping)
    .all();

  return enqueueUpdateRun({
    entries: rows.map((row) => ({
      sourceSeriesId: row.sourceSeriesId,
      source: row.source,
    })),
    trigger,
    reason,
  });
}

export function getSeriesPolicy(sourceSeriesId: string, sourceName?: string | null) {
  const mapping = getSeriesMapping(sourceSeriesId, sourceName);
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
  sourceName?: string | null;
  autoDownloadNewEnabled: boolean;
  autoDownloadNewLimit: number;
}) {
  const mapping = getSeriesMapping(input.sourceSeriesId, input.sourceName);
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

  return getSeriesPolicy(input.sourceSeriesId, input.sourceName);
}

export function enqueueRefreshAllManifests() {
  const rows = getDb()
    .select({
      source: sourceMapping.source,
      sourceSeriesId: sourceMapping.sourceSeriesId,
      sourceChapterId: chapter.sourceChapterId,
    })
    .from(mediaCache)
    .innerJoin(chapter, eq(mediaCache.chapterId, chapter.id))
    .innerJoin(
      sourceMapping,
      and(
        eq(sourceMapping.seriesId, chapter.seriesId),
        eq(sourceMapping.source, chapter.source),
      ),
    )
    .where(eq(mediaCache.state, "ready"))
    .all();

  const bySeries = new Map<string, { sourceName: string; sourceSeriesId: string; chapterIds: string[] }>();
  for (const row of rows) {
    const key = `${row.source}:${row.sourceSeriesId}`;
    const existing = bySeries.get(key) ?? {
      sourceName: row.source,
      sourceSeriesId: row.sourceSeriesId,
      chapterIds: [],
    };
    existing.chapterIds.push(row.sourceChapterId);
    bySeries.set(key, existing);
  }

  let totalQueued = 0;
  for (const { sourceName, sourceSeriesId, chapterIds } of bySeries.values()) {
    const dedupe = getActiveDedupeKeys(sourceSeriesId);
    const uniqueChapterIds = Array.from(new Set(chapterIds)).filter(
      (id) => !dedupe.has(dedupeKey(sourceName, sourceSeriesId, id)),
    );
    if (uniqueChapterIds.length === 0) continue;
    createRunWithTasks({
      kind: "download",
      trigger: "manual",
      scope: {
        reason: "refresh_manifests",
        source: sourceName,
        sourceSeriesId,
        chapterIds: uniqueChapterIds,
      },
      tasks: uniqueChapterIds.map((chapterId) => ({
        queue: "download" as const,
        taskType: "download_chapter" as const,
        sourceSeriesId,
        sourceChapterId: chapterId,
        payload: { source: sourceName },
        priority: 10,
        maxAttempts: 4,
        dedupeKey: dedupeKey(sourceName, sourceSeriesId, chapterId),
      })),
    });
    totalQueued += uniqueChapterIds.length;
  }
  return totalQueued;
}

export function enqueueOptimizeCache() {
  return createRunWithTasks({
    kind: "maintenance",
    trigger: "manual",
    scope: { reason: "optimize_cache" },
    tasks: [
      {
        queue: "maintenance",
        taskType: "optimize_cache",
        payload: {},
        priority: 1,
        maxAttempts: 1,
        dedupeKey: "optimize_cache",
      },
    ],
  });
}

export function enqueueAfterChapterCompleted(
  sourceSeriesId: string,
  sourceChapterId: string,
  sourceName?: string | null,
) {
  const settings = getBackgroundSettings();
  const mapping = getSeriesMapping(sourceSeriesId, sourceName);
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
            sourceName: mapping.source,
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
      sourceName: mapping.source,
      keepLastN: settings.autoDeleteKeepLastN,
      trigger: "automation",
      reason: "after_chapter_completed",
    });
  }
}
