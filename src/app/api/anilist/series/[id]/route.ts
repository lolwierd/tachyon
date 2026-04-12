import { NextResponse } from "next/server";
import { getSeriesAniListSyncStatus } from "@/lib/anilist/sync";
import { handleApiError } from "@/lib/server/api";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
  ) {
  const { id } = await context.params;
  try {
    return NextResponse.json(getSeriesAniListSyncStatus(id));
  } catch (error) {
    return handleApiError("api.anilist.series.failed", error, { sourceSeriesId: id });
  }
}
