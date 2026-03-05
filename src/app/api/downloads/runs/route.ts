import { NextResponse } from "next/server";
import {
  enqueueBulkDownload,
  enqueueDeleteReadDownloads,
  enqueueDownloadChapters,
  enqueueSingleChapterDownload,
  type DownloadScope,
} from "@/lib/background/enqueue";
import { listRuns, listTasksForRuns, type RunStatus } from "@/lib/background/queue";
import { getBackgroundSettings } from "@/lib/background/settings";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

const VALID_STATUSES: RunStatus[] = ["queued", "running", "succeeded", "failed", "canceling", "canceled"];

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get("limit") ?? "50", 10);
    const statusParam = searchParams.get("status");
    const seriesId = searchParams.get("seriesId") ?? undefined;
    const includeTasks = searchParams.get("includeTasks") === "true";

    const status = statusParam && VALID_STATUSES.includes(statusParam as RunStatus)
      ? statusParam as RunStatus
      : undefined;

    const runs = listRuns("download", {
      limit: Number.isFinite(limit) ? limit : 50,
      status,
      sourceSeriesId: seriesId,
    });

    if (!includeTasks) {
      return NextResponse.json({ runs });
    }

    const tasksByRun = listTasksForRuns(runs.map((r) => r.id));
    return NextResponse.json({
      runs: runs.map((run) => ({
        ...run,
        tasks: tasksByRun.get(run.id) ?? [],
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.downloads.runs.get_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      action?: "chapter" | "chapters" | "bulk" | "series" | "deleteRead";
      seriesId?: string;
      chapterId?: string;
      chapterIds?: string[];
      scope?: DownloadScope;
      keepLastN?: number;
    };

    if (!body.action) {
      return badRequest("action is required");
    }

    if (!body.seriesId) {
      return badRequest("seriesId is required");
    }

    if (body.action === "chapter") {
      if (!body.chapterId) {
        return badRequest("chapterId is required");
      }
      const run = enqueueSingleChapterDownload({
        sourceSeriesId: body.seriesId,
        sourceChapterId: body.chapterId,
        trigger: "manual",
      });
      return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
    }

    if (body.action === "chapters") {
      if (!Array.isArray(body.chapterIds) || body.chapterIds.length === 0) {
        return badRequest("chapterIds is required");
      }
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
      if (!["all", "unread", "next50", "next100"].includes(scope)) {
        return badRequest("scope must be one of: all, unread, next50, next100");
      }
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

    return badRequest("Unknown action");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.downloads.runs.post_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
