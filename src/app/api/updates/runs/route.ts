import { NextResponse } from "next/server";
import { z } from "zod";
import { enqueueUpdateRun } from "@/lib/background/enqueue";
import { getRun, listRuns, listTasksForRuns, type RunStatus } from "@/lib/background/queue";
import { getSeriesMapping } from "@/lib/library/shared";
import {
  assertTrustedWriteRequest,
  handleApiError,
  notFound,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const VALID_STATUSES: RunStatus[] = ["queued", "running", "succeeded", "failed", "canceling", "canceled"];
const singleUpdateSchema = z.object({
  seriesId: z.string().trim().min(1),
  source: z.string().trim().min(1).optional(),
});

function runMatchesSeriesSource(
  run: ReturnType<typeof listRuns>[number],
  sourceSeriesId: string,
  source: string,
) {
  const scope = run.scope;
  if (!scope || typeof scope !== "object" || !("entries" in scope)) return false;
  const entries = (scope as { entries?: unknown }).entries;
  return Array.isArray(entries) && entries.some((entry) =>
    entry
    && typeof entry === "object"
    && "sourceSeriesId" in entry
    && "source" in entry
    && entry.sourceSeriesId === sourceSeriesId
    && entry.source === source
  );
}

function findActiveUpdateRun(sourceSeriesId: string, source: string) {
  const running = listRuns("update", {
    limit: 200,
    status: "running",
    sourceSeriesId,
  });
  const queued = listRuns("update", {
    limit: 200,
    status: "queued",
    sourceSeriesId,
  });
  return [...running, ...queued].find((run) =>
    runMatchesSeriesSource(run, sourceSeriesId, source)
  ) ?? null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get("limit") ?? "50", 10);
    const statusParam = searchParams.get("status");
    const seriesId = searchParams.get("seriesId") ?? undefined;
    const runId = searchParams.get("runId");
    const includeTasks = searchParams.get("includeTasks") === "true";

    const status = statusParam && VALID_STATUSES.includes(statusParam as RunStatus)
      ? statusParam as RunStatus
      : undefined;

    const requestedRun = runId ? getRun(runId) : null;
    const runs = runId
      ? requestedRun?.kind === "update" ? [requestedRun] : []
      : listRuns("update", {
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

export async function POST(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    const input = await parseJsonBody(request, singleUpdateSchema);
    const mapping = getSeriesMapping(input.seriesId, input.source);
    if (!mapping) {
      throw notFound("Series source not found", { code: "series_source_not_found" });
    }

    const activeRun = findActiveUpdateRun(mapping.sourceSeriesId, mapping.source);
    if (activeRun) {
      return NextResponse.json({
        accepted: true,
        alreadyRunning: true,
        runId: activeRun.id,
        run: activeRun,
      });
    }

    const run = enqueueUpdateRun({
      entries: [{
        sourceSeriesId: mapping.sourceSeriesId,
        source: mapping.source,
      }],
      trigger: "manual",
      reason: "series_update",
    });

    const dedupedRun = run?.totalTasks === 0
      ? findActiveUpdateRun(mapping.sourceSeriesId, mapping.source)
      : null;
    const returnedRun = dedupedRun ?? run;
    return NextResponse.json({
      accepted: true,
      alreadyRunning: Boolean(dedupedRun),
      runId: returnedRun?.id ?? null,
      run: returnedRun,
    });
  } catch (error) {
    return handleApiError("api.updates.runs.create_failed", error);
  }
}
