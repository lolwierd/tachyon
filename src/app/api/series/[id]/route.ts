import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { series, sourceMapping } from "@/lib/db/schema";
import { getSource } from "@/lib/sources/registry";
import {
  getSeriesMapping,
  type SourceName,
} from "@/lib/library/shared";
import { warmFlareSolverrHeaders } from "@/lib/media/flaresolverr";
import "@/lib/sources/init";
import { logError, logWarn } from "@/lib/server/log";
import type { SeriesDetail } from "@/lib/sources/types";

export const runtime = "nodejs";

function safeParseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getCachedSeriesDetail(sourceSeriesId: string, sourceName: string): (SeriesDetail & { seriesId: string }) | null {
  const row = getDb()
    .select({
      seriesId: series.id,
      title: series.title,
      description: series.description,
      coverUrl: series.coverUrl,
      status: series.status,
      contentType: series.contentType,
      year: series.year,
      adult: series.adult,
      anilistId: series.anilistId,
      authors: series.authors,
      sourceTags: series.sourceTags,
    })
    .from(sourceMapping)
    .innerJoin(series, eq(sourceMapping.seriesId, series.id))
    .where(
      and(
        eq(sourceMapping.source, sourceName as SourceName),
        eq(sourceMapping.sourceSeriesId, sourceSeriesId),
      ),
    )
    .get();

  if (!row) return null;

  return {
    seriesId: row.seriesId,
    sourceId: sourceSeriesId,
    title: row.title,
    slug: "",
    coverUrl: row.coverUrl ?? `https://temp.compsci88.com/cover/fallback/${sourceSeriesId}.jpg`,
    description: row.description ?? "",
    authors: safeParseJsonArray(row.authors),
    tags: safeParseJsonArray(row.sourceTags),
    type: row.contentType ?? "",
    status: row.status ?? "",
    year: row.year ?? null,
    isAdult: row.adult ?? false,
    isOfficial: false,
    anilistUrl: row.anilistId ? `https://anilist.co/manga/${row.anilistId}` : null,
    relatedSeries: [],
  };
}

function updateCachedSeries(sourceSeriesId: string, detail: SeriesDetail, sourceName: string) {
  const mapping = getDb()
    .select({ seriesId: sourceMapping.seriesId })
    .from(sourceMapping)
    .where(
      and(
        eq(sourceMapping.source, sourceName as SourceName),
        eq(sourceMapping.sourceSeriesId, sourceSeriesId),
      ),
    )
    .get();

  if (mapping) {
    const anilistId = extractAniListId(detail.anilistUrl);
    // Never overwrite the user's manual adult/NSFW setting — only update content metadata.
    getDb()
      .update(series)
      .set({
        title: detail.title,
        description: detail.description,
        coverUrl: detail.coverUrl,
        status: normalizeStatus(detail.status),
        contentType: normalizeContentType(detail.type),
        year: detail.year,
        authors: JSON.stringify(detail.authors),
        sourceTags: JSON.stringify(detail.tags),
        ...(anilistId !== null ? { anilistId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(series.id, mapping.seriesId))
      .run();
  }
}

function extractAniListId(url: string | null | undefined): number | null {
  if (!url) return null;
  const match = url.match(/anilist\.co\/manga\/(\d+)/i);
  return match ? Number(match[1]) : null;
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
  const requestedSource = searchParams.get("source");
  const mapping = getSeriesMapping(id, requestedSource ?? undefined);
  if (!mapping && !requestedSource) {
    return NextResponse.json({ error: "Series source not found" }, { status: 404 });
  }
  const seriesId = mapping?.seriesId;
  const sourceSeriesId = mapping?.sourceSeriesId ?? id;
  const sourceName = mapping?.source ?? requestedSource;

  if (!sourceName) {
    return NextResponse.json({ error: "Series source not found" }, { status: 404 });
  }

  // Try to serve from cache for library series (unless refresh forced)
  if (!forceRefresh) {
    const cached = getCachedSeriesDetail(sourceSeriesId, sourceName);
    if (cached) {
      void warmFlareSolverrHeaders(sourceName);
      return NextResponse.json({ ...cached, source: sourceName });
    }
  }

  // Fetch from source
  try {
    const source = getSource(sourceName);
    if (!source) {
      return NextResponse.json({ error: `Unknown source: ${sourceName}` }, { status: 400 });
    }
    const detail = await source.getSeriesDetail(sourceSeriesId);
    void warmFlareSolverrHeaders(sourceName);
    updateCachedSeries(sourceSeriesId, detail, sourceName);
    return NextResponse.json({ ...detail, source: sourceName, seriesId });
  } catch (error) {
    // If source fails, try to return cached data
    const cached = getCachedSeriesDetail(sourceSeriesId, sourceName);
    if (cached) {
      logWarn("api.series.detail.source_failed_using_cache", {
        sourceId: sourceSeriesId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json({ ...cached, source: sourceName });
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.series.detail.failed", error, { sourceId: sourceSeriesId });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
