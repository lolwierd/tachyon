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

const postRunSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("chapter"),
    seriesId: sourceIdSchema,
    chapterId: sourceIdSchema,
  }),
  z.object({
    action: z.literal("chapters"),
    seriesId: sourceIdSchema,
    chapterIds: z.array(sourceIdSchema).min(1).max(500),
  }),
  z.object({
    action: z.literal("bulk"),
    seriesId: sourceIdSchema,
    scope: downloadScopeSchema.optional(),
  }),
  z.object({
    action: z.literal("series"),
    seriesId: sourceIdSchema,
  }),
  z.object({
    action: z.literal("deleteRead"),
    seriesId: sourceIdSchema,
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
    const runSeriesId = seriesId ? (getSeriesMapping(seriesId)?.sourceSeriesId ?? seriesId) : undefined;

    if (activeOnly && countOnly) {
      return NextResponse.json({ count: listActiveRuns("download").length });
    }

    const effectiveLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50;
    const runs = listRuns("download", {
      limit: effectiveLimit,
      status,
      sourceSeriesId: runSeriesId,
    });

    if (!includeTasks) {
      return NextResponse.json({ runs });
    }

    const tasksByRun = listTasksForRuns(runs.map((r) => r.id));

    // Collect unique source IDs across all tasks and run scopes for enrichment
    const seriesSourceIds = new Set<string>();
    const chapterSourceIds = new Set<string>();
    for (const run of runs) {
      const scope = run.scope as { sourceSeriesId?: string } | null;
      if (scope?.sourceSeriesId) seriesSourceIds.add(scope.sourceSeriesId);
      for (const task of tasksByRun.get(run.id) ?? []) {
        if (task.sourceSeriesId) seriesSourceIds.add(task.sourceSeriesId);
        if (task.sourceChapterId) chapterSourceIds.add(task.sourceChapterId);
      }
    }

    // Look up series titles and canonical source ids via sourceMapping.
    // Some older flows can still persist local series ids into runs.
    const seriesInfoMap = new Map<string, { title: string; seriesId: string; sourceSeriesId: string; source: string; adult: boolean }>();
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
        if (!seriesInfoMap.has(row.sourceSeriesId)) {
          seriesInfoMap.set(row.sourceSeriesId, {
            title: row.title,
            seriesId: row.seriesId,
            sourceSeriesId: row.sourceSeriesId,
            source: row.source,
            adult: row.adult ?? false,
          });
        }
        if (!seriesInfoMap.has(row.seriesId)) {
          seriesInfoMap.set(row.seriesId, {
            title: row.title,
            seriesId: row.seriesId,
            sourceSeriesId: row.sourceSeriesId,
            source: row.source,
            adult: row.adult ?? false,
          });
        }
      }
    }

    // Look up chapter numbers and titles
    const chapterInfoMap = new Map<string, { chapterNo: number; chapterTitle: string | null }>();
    if (chapterSourceIds.size > 0) {
      const rows = getDb()
        .select({ sourceChapterId: chapter.sourceChapterId, chapterNo: chapter.chapterNo, title: chapter.title })
        .from(chapter)
        .where(inArray(chapter.sourceChapterId, [...chapterSourceIds]))
        .all();
      for (const row of rows) {
        chapterInfoMap.set(row.sourceChapterId, { chapterNo: row.chapterNo, chapterTitle: row.title ?? null });
      }
    }

    return NextResponse.json({
      runs: runs.map((run) => {
        const scope = run.scope as { sourceSeriesId?: string } | null;
        const runSeriesInfo = scope?.sourceSeriesId ? (seriesInfoMap.get(scope.sourceSeriesId) ?? null) : null;
        return {
          ...run,
          seriesTitle: runSeriesInfo?.title ?? null,
          seriesLinkId: runSeriesInfo?.seriesId ?? null,
          seriesAdult: runSeriesInfo?.adult ?? null,
          tasks: (tasksByRun.get(run.id) ?? []).map((task) => ({
            ...task,
            seriesTitle: task.sourceSeriesId ? (seriesInfoMap.get(task.sourceSeriesId)?.title ?? null) : null,
            seriesLinkId: task.sourceSeriesId ? (seriesInfoMap.get(task.sourceSeriesId)?.seriesId ?? null) : null,
            seriesAdult: task.sourceSeriesId ? (seriesInfoMap.get(task.sourceSeriesId)?.adult ?? null) : null,
            chapterNo: task.sourceChapterId ? (chapterInfoMap.get(task.sourceChapterId)?.chapterNo ?? null) : null,
            chapterTitle: task.sourceChapterId ? (chapterInfoMap.get(task.sourceChapterId)?.chapterTitle ?? null) : null,
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
      const run = enqueueDownloadChapters({
        sourceSeriesId,
        chapterIds,
        trigger: "manual",
        reason: "retry:failed",
      });
      return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
    }

    if (body.action === "chapter") {
      const run = enqueueSingleChapterDownload({
        sourceSeriesId: body.seriesId,
        sourceChapterId: body.chapterId,
        trigger: "manual",
      });
      return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
    }

    if (body.action === "chapters") {
      const run = enqueueDownloadChapters({
        sourceSeriesId: body.seriesId,
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
