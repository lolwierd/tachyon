import { NextResponse } from "next/server";
import { listRuns, listTasksForRuns, type RunStatus } from "@/lib/background/queue";
import { handleApiError } from "@/lib/server/api";

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
      limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50,
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
    return handleApiError("api.updates.runs.get_failed", error);
  }
}
