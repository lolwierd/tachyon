import { NextResponse } from "next/server";
import { getSeriesAniListSyncStatus } from "@/lib/anilist/sync";
import { handleApiError } from "@/lib/server/api";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
  ) {
  try {
    const { id } = await context.params;
    return NextResponse.json(getSeriesAniListSyncStatus(id));
  } catch (error) {
    const { id } = await context.params;
    return handleApiError("api.anilist.series.failed", error, { sourceSeriesId: id });
  }
}
