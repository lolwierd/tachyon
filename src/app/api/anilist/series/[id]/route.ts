import { NextResponse } from "next/server";
import { getSeriesAniListSyncStatus } from "@/lib/anilist/sync";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json(getSeriesAniListSyncStatus(id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.anilist.series.failed", error, { sourceSeriesId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
