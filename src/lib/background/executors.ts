import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { backgroundRun, chapter, series, seriesDownloadPolicy } from "@/lib/db/schema";
import { deleteReadChaptersKeepLastN, pinChapter } from "@/lib/offline/state";
import { optimizeAllCachedImages } from "@/lib/media/cache";
import { getBackgroundSettings } from "@/lib/background/settings";
import { enqueueDownloadChapters } from "@/lib/background/enqueue";
import { getSource } from "@/lib/sources/registry";
import { ensureSeriesRecord, getSeriesMapping } from "@/lib/library/shared";
import "@/lib/sources/init";
import type { ClaimedTask } from "@/lib/background/queue";

function normalizeStatus(status: string | null | undefined) {
  switch (status?.toLowerCase()) {
    case "ongoing": return "ongoing" as const;
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
    case "manga": return "manga" as const;
    case "manhwa": return "manhwa" as const;
    case "manhua": return "manhua" as const;
    case "oel": return "oel" as const;
    default:
      return null;
  }
}

function extractAniListId(url: string | null | undefined): number | null {
  if (!url) return null;
  const match = url.match(/anilist\.co\/manga\/(\d+)/i);
  return match ? Number(match[1]) : null;
}

async function refreshSeriesFromSource(sourceSeriesId: string, options?: { signal?: AbortSignal }) {
  const mapping = getSeriesMapping(sourceSeriesId);
  if (!mapping) throw new Error(`Series source not found for ${sourceSeriesId}`);
  const sourceName = mapping.source;
  const source = getSource(sourceName)!;
  const localSeriesId = await ensureSeriesRecord(sourceSeriesId, undefined, sourceName);
  options?.signal?.throwIfAborted();
  const detail = await source.getSeriesDetail(sourceSeriesId);
  const now = new Date();

  // Never overwrite the user's manual adult/NSFW setting — only update content metadata.
  const anilistId = extractAniListId(detail.anilistUrl);
  getDb().update(series)
    .set({
      title: detail.title,
      description: detail.description,
      coverUrl: detail.coverUrl,
      status: normalizeStatus(detail.status),
      contentType: normalizeContentType(detail.type),
      year: detail.year,
      authors: JSON.stringify(detail.authors ?? []),
      sourceTags: JSON.stringify(detail.tags ?? []),
      ...(anilistId !== null ? { anilistId } : {}),
      updatedAt: now,
    })
    .where(eq(series.id, localSeriesId))
    .run();

  const existingChapters = new Map(
    getDb().select({ id: chapter.id, sourceChapterId: chapter.sourceChapterId })
      .from(chapter)
      .where(and(eq(chapter.seriesId, localSeriesId), eq(chapter.source, sourceName)))
      .all()
      .map((row) => [row.sourceChapterId, row.id]),
  );

  options?.signal?.throwIfAborted();
  const chapterList = await source.getChapterList(sourceSeriesId);
  const newChapterIds: string[] = [];

  for (const chapterItem of chapterList) {
    const existingId = existingChapters.get(chapterItem.sourceChapterId);
    if (existingId) {
      getDb().update(chapter)
        .set({ chapterNo: chapterItem.chapterNo, title: chapterItem.title, sortKey: chapterItem.chapterNo })
        .where(eq(chapter.id, existingId))
        .run();
      continue;
    }

    getDb().insert(chapter).values({
      id: crypto.randomUUID(),
      seriesId: localSeriesId,
      source: sourceName,
      sourceChapterId: chapterItem.sourceChapterId,
      chapterNo: chapterItem.chapterNo,
      title: chapterItem.title,
      pageCount: 0,
      sortKey: chapterItem.chapterNo,
      createdAt: now,
    }).run();

    newChapterIds.push(chapterItem.sourceChapterId);
  }

  return {
    sourceSeriesId,
    localSeriesId,
    newChapterIds,
    chapterList,
  };
}

async function enqueueAutoDownloadsForNewChapters(result: {
  sourceSeriesId: string;
  localSeriesId: string;
  newChapterIds: string[];
  chapterList: Array<{ sourceChapterId: string; chapterNo: number }>;
}) {
  if (result.newChapterIds.length === 0) {
    return;
  }

  const settings = getBackgroundSettings();
  const policy = getDb().select()
    .from(seriesDownloadPolicy)
    .where(eq(seriesDownloadPolicy.seriesId, result.localSeriesId))
    .get();

  if (!policy?.autoDownloadNewEnabled) {
    return;
  }

  const limit = Math.min(
    Math.max(policy.autoDownloadNewLimit || settings.defaultNewChapterLimit, 1),
    50,
  );

  const newSet = new Set(result.newChapterIds);
  const newestIds = result.chapterList
    .filter((ch) => newSet.has(ch.sourceChapterId))
    .sort((a, b) => b.chapterNo - a.chapterNo)
    .slice(0, limit)
    .map((ch) => ch.sourceChapterId);

  if (newestIds.length === 0) {
    return;
  }

  enqueueDownloadChapters({
    sourceSeriesId: result.sourceSeriesId,
    chapterIds: newestIds,
    trigger: "automation",
    reason: "update_detected_new_chapters",
  });
}

function readKeepLastN(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return 0;
  }

  const value = (payload as { keepLastN?: unknown }).keepLastN;
  if (typeof value !== "number") {
    return 0;
  }

  return Math.max(Math.trunc(value), 0);
}

export async function executeTask(task: ClaimedTask, options?: { signal?: AbortSignal }) {
  if (task.taskType === "download_chapter") {
    if (!task.sourceSeriesId || !task.sourceChapterId) {
      throw new Error("download_chapter task missing source ids");
    }

    await pinChapter(task.sourceSeriesId, task.sourceChapterId, undefined, { signal: options?.signal });
    return;
  }

  if (task.taskType === "delete_read_downloads") {
    if (!task.sourceSeriesId) {
      throw new Error("delete_read_downloads task missing sourceSeriesId");
    }

    const keepLastN = readKeepLastN(task.payload);
    await deleteReadChaptersKeepLastN(task.sourceSeriesId, keepLastN);
    return;
  }

  if (task.taskType === "refresh_series") {
    if (!task.sourceSeriesId) {
      throw new Error("refresh_series task missing sourceSeriesId");
    }

    const result = await refreshSeriesFromSource(task.sourceSeriesId, { signal: options?.signal });
    await enqueueAutoDownloadsForNewChapters(result);
    return;
  }

  if (task.taskType === "optimize_cache") {
    await optimizeAllCachedImages();
    return;
  }

  throw new Error(`Unsupported task type: ${task.taskType}`);
}

export function isRetryableTaskError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const text = `${error.name} ${error.message}`.toLowerCase();
  return (
    text.includes("timeout") ||
    text.includes("abort") ||
    text.includes("429") ||
    text.includes("5") ||
    text.includes("fetch") ||
    text.includes("network")
  );
}

export function isRunCancellationRequested(runId: string) {
  const run = getDb().select({ cancelRequestedAt: backgroundRun.cancelRequestedAt })
    .from(backgroundRun)
    .where(eq(backgroundRun.id, runId))
    .get();

  return Boolean(run?.cancelRequestedAt);
}
