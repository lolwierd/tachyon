import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelRunsByKindScope, requestCancelRun } from "@/lib/background/queue";
import { getSeriesMapping } from "@/lib/library/shared";
import {
  assertTrustedWriteRequest,
  handleApiError,
  notFound,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const cancelBodySchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("all"),
  }),
  z.object({
    scope: z.literal("series"),
    seriesId: z.string().trim().min(1),
  }),
  z.object({
    scope: z.literal("count"),
    count: z.number().positive(),
  }),
  z.object({
    scope: z.literal("run"),
    runId: z.string().trim().min(1),
  }),
]);

export async function POST(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    const body = await parseJsonBody(request, cancelBodySchema);

    if (body.scope === "all") {
      return NextResponse.json(cancelRunsByKindScope({ kind: "download", all: true }));
    }

    if (body.scope === "series") {
      const mapping = getSeriesMapping(body.seriesId);
      if (!mapping) {
        throw notFound("Series mapping not found", { code: "series_mapping_not_found" });
      }
      return NextResponse.json(
        cancelRunsByKindScope({ kind: "download", sourceSeriesId: mapping.sourceSeriesId }),
      );
    }

    if (body.scope === "count") {
      return NextResponse.json(cancelRunsByKindScope({ kind: "download", count: Math.trunc(body.count) }));
    }

    if (body.scope === "run") {
      const run = requestCancelRun(body.runId);
      return NextResponse.json({ requested: run ? 1 : 0, runs: run ? [run] : [] });
    }
  } catch (error) {
    return handleApiError("api.downloads.cancel.post_failed", error);
  }
}
