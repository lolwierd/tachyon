import { NextResponse } from "next/server";
import { getSeriesDetail } from "@/lib/sources/weebcentral";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const detail = await getSeriesDetail(id);
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.series.detail.failed", error, { sourceId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
