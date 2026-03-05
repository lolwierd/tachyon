import { NextResponse } from "next/server";
import { cancelRunsByKindScope, requestCancelRun } from "@/lib/background/queue";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      scope?: "all" | "series" | "count" | "run";
      seriesId?: string;
      count?: number;
      runId?: string;
    };

    if (!body.scope) {
      return badRequest("scope is required");
    }

    if (body.scope === "all") {
      return NextResponse.json(cancelRunsByKindScope({ kind: "download", all: true }));
    }

    if (body.scope === "series") {
      if (!body.seriesId) {
        return badRequest("seriesId is required for series scope");
      }
      return NextResponse.json(
        cancelRunsByKindScope({ kind: "download", sourceSeriesId: body.seriesId }),
      );
    }

    if (body.scope === "count") {
      if (typeof body.count !== "number" || body.count <= 0) {
        return badRequest("count must be a positive number");
      }
      return NextResponse.json(cancelRunsByKindScope({ kind: "download", count: Math.trunc(body.count) }));
    }

    if (body.scope === "run") {
      if (!body.runId) {
        return badRequest("runId is required for run scope");
      }
      const run = requestCancelRun(body.runId);
      return NextResponse.json({ requested: run ? 1 : 0, runs: run ? [run] : [] });
    }

    return badRequest("Unknown scope");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.downloads.cancel.post_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
