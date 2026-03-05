import { NextResponse } from "next/server";
import { listRuns, listTasksForRuns, type RunStatus } from "@/lib/background/queue";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

const VALID_STATUSES: RunStatus[] = ["queued", "running", "succeeded", "failed", "canceling", "canceled"];

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

    const runs = listRuns("update", {
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
    logError("api.updates.runs.get_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
