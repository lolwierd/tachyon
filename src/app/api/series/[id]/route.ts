import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { series, sourceMapping } from "@/lib/db/schema";
import { getSeriesDetail } from "@/lib/sources/weebcentral";
import { logError, logWarn } from "@/lib/server/log";
import type { SeriesDetail } from "@/lib/sources/types";

export const runtime = "nodejs";

const SOURCE = "weebcentral" as const;

function getCachedSeriesDetail(sourceSeriesId: string): SeriesDetail | null {
  const row = getDb()
    .select({
      title: series.title,
      description: series.description,
      coverUrl: series.coverUrl,
      status: series.status,
      contentType: series.contentType,
      year: series.year,
      adult: series.adult,
    })
    .from(sourceMapping)
    .innerJoin(series, eq(sourceMapping.seriesId, series.id))
    .where(
      and(
        eq(sourceMapping.source, SOURCE),
        eq(sourceMapping.sourceSeriesId, sourceSeriesId),
      ),
    )
    .get();

  if (!row) return null;

  return {
    sourceId: sourceSeriesId,
    title: row.title,
    slug: "",
    coverUrl: row.coverUrl ?? `https://temp.compsci88.com/cover/fallback/${sourceSeriesId}.jpg`,
    description: row.description ?? "",
    authors: [],
    tags: [],
    type: row.contentType ?? "",
    status: row.status ?? "",
    year: row.year ?? null,
    isAdult: row.adult ?? false,
    isOfficial: false,
    anilistUrl: null,
    relatedSeries: [],
  };
}

function updateCachedSeries(sourceSeriesId: string, detail: SeriesDetail) {
  const mapping = getDb()
    .select({ seriesId: sourceMapping.seriesId })
    .from(sourceMapping)
    .where(
      and(
        eq(sourceMapping.source, SOURCE),
        eq(sourceMapping.sourceSeriesId, sourceSeriesId),
      ),
    )
    .get();

  if (mapping) {
    getDb()
      .update(series)
      .set({
        title: detail.title,
        description: detail.description,
        coverUrl: detail.coverUrl,
        status: normalizeStatus(detail.status),
        contentType: normalizeContentType(detail.type),
        year: detail.year,
        adult: detail.isAdult,
        updatedAt: new Date(),
      })
      .where(eq(series.id, mapping.seriesId))
      .run();
  }
}

function normalizeStatus(status: string | null | undefined) {
  switch (status?.toLowerCase()) {
    case "ongoing": return "ongoing" as const;
    case "complete": case "completed": return "complete" as const;
    case "hiatus": return "hiatus" as const;
    case "canceled": case "cancelled": return "canceled" as const;
    default: return null;
  }
}

function normalizeContentType(type: string | null | undefined) {
  switch (type?.toLowerCase()) {
    case "manga": return "manga" as const;
    case "manhwa": return "manhwa" as const;
    case "manhua": return "manhua" as const;
    case "oel": return "oel" as const;
    default: return null;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const forceRefresh = searchParams.get("refresh") === "true";

  // Try to serve from cache for library series (unless refresh forced)
  if (!forceRefresh) {
    const cached = getCachedSeriesDetail(id);
    if (cached) {
      return NextResponse.json(cached);
    }
  }

  // Fetch from source
  try {
    const detail = await getSeriesDetail(id);
    // Update cache in background
    updateCachedSeries(id, detail);
    return NextResponse.json(detail);
  } catch (error) {
    // If source fails, try to return cached data
    const cached = getCachedSeriesDetail(id);
    if (cached) {
      logWarn("api.series.detail.source_failed_using_cache", {
        sourceId: id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json(cached);
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.series.detail.failed", error, { sourceId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
