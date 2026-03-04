import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { series, sourceMapping } from "@/lib/db/schema";
import { getSeriesDetail } from "@/lib/sources/weebcentral";
import type { SeriesDetail } from "@/lib/sources/types";

export const SOURCE = "weebcentral" as const;

function extractAniListId(url: string | null | undefined) {
  if (!url) {
    return null;
  }

  const match = url.match(/anilist\.co\/manga\/(\d+)/i);
  return match ? Number(match[1]) : null;
}

function normalizeStatus(status: string | null | undefined) {
  switch (status?.toLowerCase()) {
    case "ongoing":
      return "ongoing" as const;
    case "complete":
    case "completed":
      return "complete" as const;
    case "hiatus":
      return "hiatus" as const;
    case "canceled":
    case "cancelled":
      return "canceled" as const;
    default:
      return null;
  }
}

function normalizeContentType(type: string | null | undefined) {
  switch (type?.toLowerCase()) {
    case "manga":
      return "manga" as const;
    case "manhwa":
      return "manhwa" as const;
    case "manhua":
      return "manhua" as const;
    case "oel":
      return "oel" as const;
    default:
      return null;
  }
}

export function getSeriesMapping(sourceSeriesId: string) {
  return getDb()
    .select({
      seriesId: sourceMapping.seriesId,
    })
    .from(sourceMapping)
    .where(
      and(
        eq(sourceMapping.source, SOURCE),
        eq(sourceMapping.sourceSeriesId, sourceSeriesId),
      ),
    )
    .get();
}

export async function ensureSeriesRecord(sourceSeriesId: string, detail?: SeriesDetail) {
  const existing = getSeriesMapping(sourceSeriesId);
  if (existing) {
    const anilistId = extractAniListId(detail?.anilistUrl);

    if (anilistId !== null) {
      getDb()
        .update(series)
        .set({
          anilistId,
          updatedAt: new Date(),
        })
        .where(eq(series.id, existing.seriesId))
        .run();
    }

    return existing.seriesId;
  }

  const remoteDetail = detail ?? await getSeriesDetail(sourceSeriesId);
  const seriesId = crypto.randomUUID();

  getDb()
    .insert(series)
    .values({
      id: seriesId,
      title: remoteDetail.title,
      description: remoteDetail.description,
      coverUrl: remoteDetail.coverUrl,
      anilistId: extractAniListId(remoteDetail.anilistUrl),
      status: normalizeStatus(remoteDetail.status),
      contentType: normalizeContentType(remoteDetail.type),
      year: remoteDetail.year,
      adult: remoteDetail.isAdult,
      updatedAt: new Date(),
    })
    .run();

  getDb()
    .insert(sourceMapping)
    .values({
      id: crypto.randomUUID(),
      seriesId,
      source: SOURCE,
      sourceSeriesId,
      sourceUrl: `https://weebcentral.com/series/${sourceSeriesId}/`,
    })
    .run();

  return seriesId;
}
