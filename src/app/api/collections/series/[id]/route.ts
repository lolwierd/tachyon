import { NextResponse } from "next/server";
import { listCollectionIdsForSeries, replaceSeriesCollections } from "@/lib/library/collections";
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
    return NextResponse.json({ collectionIds: listCollectionIdsForSeries(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.series.collections.list.failed", error, { sourceSeriesId: id });
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
    const collectionIds = Array.isArray(body.collectionIds)
      ? body.collectionIds.filter((value): value is string => typeof value === "string")
      : null;

    if (!collectionIds) {
      return badRequest("collectionIds are required");
    }

    const nextCollectionIds = await replaceSeriesCollections(
      id,
      collectionIds,
      isSeriesDetail(body.series) ? body.series : undefined,
    );

    return NextResponse.json({ collectionIds: nextCollectionIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.series.collections.replace.failed", error, { sourceSeriesId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
