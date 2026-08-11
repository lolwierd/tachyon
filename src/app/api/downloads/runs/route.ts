import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enqueueBulkDownload,
  enqueueDeleteReadDownloads,
  enqueueDownloadChapters,
  enqueueSingleChapterDownload,
  type DownloadScope,
} from "@/lib/background/enqueue";
import { listActiveRuns, listRuns, listTasksForRun, listTasksForRuns, type RunStatus } from "@/lib/background/queue";
import { getBackgroundSettings } from "@/lib/background/settings";
import { getDb } from "@/lib/db";
import { chapter, series, sourceMapping } from "@/lib/db/schema";
import { inArray, eq, or } from "drizzle-orm";
import { getSeriesMapping } from "@/lib/library/shared";
import {
  assertTrustedWriteRequest,
  badRequest,
  handleApiError,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const VALID_STATUSES: RunStatus[] = ["queued", "running", "succeeded", "failed", "canceling", "canceled"];

const downloadScopeSchema = z.enum(["all", "unread", "next5", "next10", "next50", "next100"]);
const sourceIdSchema = z.string().trim().min(1);

function readTaskSource(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const source = (payload as { source?: unknown }).source;
  return typeof source === "string" && source.trim() ? source : undefined;
}

function readScopeSource(scope: unknown): string | undefined {
  if (!scope || typeof scope !== "object") return undefined;
  const source = (scope as { source?: unknown }).source;
  return typeof source === "string" && source.trim() ? source : undefined;
}

const postRunSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("chapter"),
    seriesId: sourceIdSchema,
    chapterId: sourceIdSchema,
    source: sourceIdSchema,
  }),
  z.object({
    action: z.literal("chapters"),
    seriesId: sourceIdSchema,
    chapterIds: z.array(sourceIdSchema).min(1).max(500),
    source: sourceIdSchema,
  }),
  z.object({
    action: z.literal("bulk"),
    seriesId: sourceIdSchema,
    source: sourceIdSchema,
    scope: downloadScopeSchema.optional(),
  }),
  z.object({
    action: z.literal("series"),
    seriesId: sourceIdSchema,
    source: sourceIdSchema,
  }),
  z.object({
    action: z.literal("deleteRead"),
    seriesId: sourceIdSchema,
    source: sourceIdSchema,
    keepLastN: z.number().int().min(0).max(200).optional(),
  }),
  z.object({
    action: z.literal("retryFailed"),
    runId: z.string().trim().min(1),
  }),
]);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get("limit") ?? "50", 10);
    const statusParam = searchParams.get("status");
    const seriesId = searchParams.get("seriesId") ?? undefined;
    const includeTasks = searchParams.get("includeTasks") === "true";
    const activeOnly = searchParams.get("activeOnly") === "true";
    const countOnly = searchParams.get("countOnly") === "true";

    const status = statusParam && VALID_STATUSES.includes(statusParam as RunStatus)
      ? statusParam as RunStatus
      : undefined;
    const sourceName = searchParams.get("source") ?? undefined;
    const runSeriesId = seriesId
      ? (getSeriesMapping(seriesId, sourceName)?.sourceSeriesId ?? seriesId)
      : undefined;

    if (activeOnly && countOnly) {
      const activeFilter = runSeriesId || sourceName
        ? { sourceSeriesId: runSeriesId, sourceName }
        : undefined;
      const activeRuns = activeFilter
        ? listActiveRuns("download", activeFilter)
        : listActiveRuns("download");
      return NextResponse.json({
        count: activeRuns.length,
      });
    }

    const effectiveLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50;
    const runs = listRuns("download", {
      limit: effectiveLimit,
      status,
      sourceSeriesId: runSeriesId,
      sourceName,
    });

    if (!includeTasks) {
      return NextResponse.json({ runs });
    }

    const tasksByRun = listTasksForRuns(runs.map((r) => r.id));

    // Collect unique source IDs across all tasks and run scopes for enrichment
    const seriesSourceIds = new Set<string>();
    const chapterSourceIds = new Set<string>();
    for (const run of runs) {
      const scope = run.scope as { sourceSeriesId?: string; source?: string } | null;
      if (scope?.sourceSeriesId) seriesSourceIds.add(scope.sourceSeriesId);
      for (const task of tasksByRun.get(run.id) ?? []) {
        if (task.sourceSeriesId) seriesSourceIds.add(task.sourceSeriesId);
        if (task.sourceChapterId) chapterSourceIds.add(task.sourceChapterId);
      }
    }

    // Look up series titles and canonical source ids via sourceMapping.
    // Some older flows can still persist local series ids into runs.
    type SeriesInfo = {
      title: string;
      seriesId: string;
      sourceSeriesId: string;
      source: string;
      adult: boolean;
    };
    const seriesInfoMap = new Map<string, SeriesInfo[]>();
    const addSeriesInfo = (key: string, info: SeriesInfo) => {
      const entries = seriesInfoMap.get(key) ?? [];
      if (!entries.some((entry) => entry.seriesId === info.seriesId && entry.source === info.source)) {
        entries.push(info);
      }
      seriesInfoMap.set(key, entries);
    };
    const findSeriesInfo = (key: string | undefined, source?: string) => {
      if (!key) return null;
      const entries = seriesInfoMap.get(key) ?? [];
      if (source) return entries.find((entry) => entry.source === source) ?? null;
      return entries.length === 1 ? entries[0] : null;
    };
    if (seriesSourceIds.size > 0) {
      const rows = getDb()
        .select({
          seriesId: series.id,
          sourceSeriesId: sourceMapping.sourceSeriesId,
          source: sourceMapping.source,
          title: series.title,
          adult: series.adult,
        })
        .from(sourceMapping)
        .innerJoin(series, eq(series.id, sourceMapping.seriesId))
        .where(
          or(
            inArray(sourceMapping.sourceSeriesId, [...seriesSourceIds]),
            inArray(series.id, [...seriesSourceIds]),
          ),
        )
        .all();
      for (const row of rows) {
        const info = {
          title: row.title,
          seriesId: row.seriesId,
          sourceSeriesId: row.sourceSeriesId,
          source: row.source,
          adult: row.adult ?? false,
        } satisfies SeriesInfo;
        addSeriesInfo(row.sourceSeriesId, info);
        addSeriesInfo(row.seriesId, info);
      }
    }

    // Look up chapter numbers and titles
    type ChapterInfo = { source: string; chapterNo: number; chapterTitle: string | null };
    const chapterInfoMap = new Map<string, ChapterInfo[]>();
    const addChapterInfo = (key: string, info: ChapterInfo) => {
      const entries = chapterInfoMap.get(key) ?? [];
      if (!entries.some((entry) => entry.source === info.source)) entries.push(info);
      chapterInfoMap.set(key, entries);
    };
    const findChapterInfo = (key: string | undefined, source?: string) => {
      if (!key) return null;
      const entries = chapterInfoMap.get(key) ?? [];
      if (source) return entries.find((entry) => entry.source === source) ?? null;
      return entries.length === 1 ? entries[0] : null;
    };
    if (chapterSourceIds.size > 0) {
      const rows = getDb()
        .select({
          source: chapter.source,
          sourceChapterId: chapter.sourceChapterId,
          chapterNo: chapter.chapterNo,
          title: chapter.title,
        })
        .from(chapter)
        .where(inArray(chapter.sourceChapterId, [...chapterSourceIds]))
        .all();
      for (const row of rows) {
        addChapterInfo(row.sourceChapterId, {
          source: row.source,
          chapterNo: row.chapterNo,
          chapterTitle: row.title ?? null,
        });
      }
    }

    return NextResponse.json({
      runs: runs.map((run) => {
        const scope = run.scope as { sourceSeriesId?: string; source?: string } | null;
        const runSource = readScopeSource(scope);
        const runSeriesInfo = findSeriesInfo(scope?.sourceSeriesId, runSource);
        return {
          ...run,
          seriesTitle: runSeriesInfo?.title ?? null,
          seriesLinkId: runSeriesInfo?.seriesId ?? null,
          seriesAdult: runSeriesInfo?.adult ?? null,
          source: runSeriesInfo?.source ?? runSource ?? null,
          tasks: (tasksByRun.get(run.id) ?? []).map((task) => ({
            ...task,
            source: readTaskSource(task.payload) ?? runSource ?? null,
            seriesTitle: task.sourceSeriesId
              ? (findSeriesInfo(task.sourceSeriesId, readTaskSource(task.payload) ?? runSource)?.title ?? null)
              : null,
            seriesLinkId: task.sourceSeriesId
              ? (findSeriesInfo(task.sourceSeriesId, readTaskSource(task.payload) ?? runSource)?.seriesId ?? null)
              : null,
            seriesAdult: task.sourceSeriesId
              ? (findSeriesInfo(task.sourceSeriesId, readTaskSource(task.payload) ?? runSource)?.adult ?? null)
              : null,
            chapterNo: task.sourceChapterId
              ? (findChapterInfo(task.sourceChapterId, readTaskSource(task.payload) ?? runSource)?.chapterNo ?? null)
              : null,
            chapterTitle: task.sourceChapterId
              ? (findChapterInfo(task.sourceChapterId, readTaskSource(task.payload) ?? runSource)?.chapterTitle ?? null)
              : null,
          })),
        };
      }),
    });
  } catch (error) {
    return handleApiError("api.downloads.runs.get_failed", error, { url: request.url });
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    const body = await parseJsonBody(request, postRunSchema);

    // retryFailed only needs runId, not seriesId
    if (body.action === "retryFailed") {
      const failedTasks: ReturnType<typeof listTasksForRun> = [];
      let offset = 0;
      while (true) {
        const page = listTasksForRun(body.runId, { limit: 500, offset });
        if (page.length === 0) break;
        for (const task of page) {
          if (task.state === "failed") failedTasks.push(task);
        }
        if (page.length < 500) break;
        offset += page.length;
      }
      if (failedTasks.length === 0) {
        return NextResponse.json({ accepted: true, runId: null, run: null });
      }
      const sourceSeriesId = failedTasks[0].sourceSeriesId;
      if (!sourceSeriesId) {
        throw badRequest("Could not determine series for run");
      }
      const chapterIds = failedTasks
        .filter((t) => t.sourceChapterId)
        .map((t) => t.sourceChapterId as string);
      const sourceName = failedTasks
        .map((task) => {
          const payload = task.payload;
          if (!payload || typeof payload !== "object") return undefined;
          const value = (payload as { source?: unknown }).source;
          return typeof value === "string" ? value : undefined;
        })
        .find((value): value is string => Boolean(value));
      const run = enqueueDownloadChapters({
        sourceSeriesId,
        sourceName,
        chapterIds,
        trigger: "manual",
        reason: "retry:failed",
      });
      return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
    }

    if (body.action === "chapter") {
      const run = enqueueSingleChapterDownload({
        sourceSeriesId: body.seriesId,
        sourceName: body.source,
        sourceChapterId: body.chapterId,
        trigger: "manual",
      });
      return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
    }

    if (body.action === "chapters") {
      const run = enqueueDownloadChapters({
        sourceSeriesId: body.seriesId,
        sourceName: body.source,
        chapterIds: body.chapterIds,
        trigger: "manual",
        reason: "manual:chapters",
      });
      return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
    }

    if (body.action === "bulk" || body.action === "series") {
      const scope: DownloadScope = body.action === "series" ? "all" : (body.scope ?? "all");
      const run = await enqueueBulkDownload({
        sourceSeriesId: body.seriesId,
        sourceName: body.source,
        scope,
        trigger: "manual",
      });
      return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
    }

    if (body.action === "deleteRead") {
      const settings = getBackgroundSettings();
      const keepLastN = typeof body.keepLastN === "number"
        ? body.keepLastN
        : settings.autoDeleteKeepLastN;
      const run = enqueueDeleteReadDownloads({
        sourceSeriesId: body.seriesId,
        sourceName: body.source,
        keepLastN,
        trigger: "manual",
        reason: "manual:deleteRead",
      });
      return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return handleApiError("api.downloads.runs.post_failed", error, { url: request.url });
  }
}
