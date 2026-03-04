import { NextResponse } from "next/server";
import { listTagIdsForSeries, replaceSeriesTags } from "@/lib/library/tags";
import type { SeriesDetail } from "@/lib/sources/types";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isSeriesDetail(value: unknown): value is SeriesDetail {
  if (!value || typeof value !== "object") {
    return false;
  }

  const detail = value as Partial<SeriesDetail>;
  return typeof detail.sourceId === "string" && typeof detail.title === "string";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ tagIds: listTagIdsForSeries(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.series.tags.list.failed", error, { sourceSeriesId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const tagIds = Array.isArray(body.tagIds)
      ? (body.tagIds as unknown[]).filter((value): value is string => typeof value === "string")
      : null;

    if (!tagIds) {
      return badRequest("tagIds are required");
    }

    const nextTagIds = await replaceSeriesTags(
      id,
      tagIds,
      isSeriesDetail(body.series) ? body.series : undefined,
    );

    return NextResponse.json({ tagIds: nextTagIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.series.tags.replace.failed", error, { sourceSeriesId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
