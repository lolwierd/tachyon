import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  chapter,
  libraryEntry,
  mediaCache,
  readingProgress,
  series,
  seriesDownloadPolicy,
  sourceMapping,
} from "@/lib/db/schema";
import { getSource } from "@/lib/sources/registry";
import type { SeriesDetail } from "@/lib/sources/types";

export const SOURCE = "weebcentral" as const;
export type SourceName = NonNullable<typeof sourceMapping.$inferSelect.source>;
type SeriesMappingRecord = {
  seriesId: string;
  sourceSeriesId: string;
  source: SourceName;
  sourceUrl: string | null;
  updatedAt: Date | null;
};

type DbLike = ReturnType<typeof getDb>;

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

function listSeriesMappingsBySourceId(sourceSeriesId: string, sourceName?: string) {
  return getDb()
    .select({
      seriesId: sourceMapping.seriesId,
      sourceSeriesId: sourceMapping.sourceSeriesId,
      source: sourceMapping.source,
      sourceUrl: sourceMapping.sourceUrl,
      updatedAt: series.updatedAt,
    })
    .from(sourceMapping)
    .innerJoin(series, eq(sourceMapping.seriesId, series.id))
    .where(
      sourceName
        ? and(
          eq(sourceMapping.source, sourceName as SourceName),
          eq(sourceMapping.sourceSeriesId, sourceSeriesId),
        )
        : eq(sourceMapping.sourceSeriesId, sourceSeriesId),
    )
    .all();
}

function findSeriesMappingBySourceId(
  db: DbLike,
  sourceSeriesId: string,
  sourceName: SourceName,
) {
  return db
    .select({
      seriesId: sourceMapping.seriesId,
      sourceSeriesId: sourceMapping.sourceSeriesId,
      source: sourceMapping.source,
      sourceUrl: sourceMapping.sourceUrl,
      updatedAt: series.updatedAt,
    })
    .from(sourceMapping)
    .innerJoin(series, eq(sourceMapping.seriesId, series.id))
    .where(
      and(
        eq(sourceMapping.source, sourceName),
        eq(sourceMapping.sourceSeriesId, sourceSeriesId),
      ),
    )
    .get();
}

function listSeriesMappingsBySeriesId(seriesId: string, sourceName?: string) {
  return getDb()
    .select({
      seriesId: sourceMapping.seriesId,
      sourceSeriesId: sourceMapping.sourceSeriesId,
      source: sourceMapping.source,
      sourceUrl: sourceMapping.sourceUrl,
      updatedAt: series.updatedAt,
    })
    .from(sourceMapping)
    .innerJoin(series, eq(sourceMapping.seriesId, series.id))
    .where(
      sourceName
        ? and(
          eq(sourceMapping.seriesId, seriesId),
          eq(sourceMapping.source, sourceName as SourceName),
        )
        : eq(sourceMapping.seriesId, seriesId),
    )
    .all();
}

function scoreSeriesMapping(row: SeriesMappingRecord) {
  const hasLibraryEntry = Boolean(
    getDb()
      .select({ seriesId: libraryEntry.seriesId })
      .from(libraryEntry)
      .where(eq(libraryEntry.seriesId, row.seriesId))
      .get(),
  );

  const hasReadingProgress = Boolean(
    getDb()
      .select({ seriesId: readingProgress.seriesId })
      .from(readingProgress)
      .where(eq(readingProgress.seriesId, row.seriesId))
      .get(),
  );

  const hasDownloadPolicy = Boolean(
    getDb()
      .select({ seriesId: seriesDownloadPolicy.seriesId })
      .from(seriesDownloadPolicy)
      .where(eq(seriesDownloadPolicy.seriesId, row.seriesId))
      .get(),
  );

  const chapterCount = getDb()
    .select({ value: count() })
    .from(chapter)
    .where(eq(chapter.seriesId, row.seriesId))
    .get()?.value ?? 0;

  const downloadedCount = getDb()
    .select({ value: count() })
    .from(mediaCache)
    .innerJoin(chapter, eq(mediaCache.chapterId, chapter.id))
    .where(and(eq(chapter.seriesId, row.seriesId), eq(mediaCache.state, "ready")))
    .get()?.value ?? 0;

  return {
    score:
      (hasLibraryEntry ? 100 : 0) +
      (hasReadingProgress ? 50 : 0) +
      (hasDownloadPolicy ? 25 : 0) +
      Math.min(downloadedCount, 10) +
      Math.min(chapterCount, 10),
    updatedAt: row.updatedAt?.getTime() ?? 0,
  };
}

export function getSeriesMapping(sourceSeriesId: string, sourceName?: string) {
  const localRows = listSeriesMappingsBySeriesId(sourceSeriesId, sourceName);
  const rows = localRows.length > 0 ? localRows : listSeriesMappingsBySourceId(sourceSeriesId, sourceName);

  if (sourceName) {
    return rows[0] ?? null;
  }

  if (rows.length <= 1) {
    return rows[0] ?? null;
  }

  const scores = new Map(rows.map((row) => [row.seriesId, scoreSeriesMapping(row)]));
  return [...rows].sort((left, right) => {
    const leftScore = scores.get(left.seriesId)!;
    const rightScore = scores.get(right.seriesId)!;
    if (leftScore.score !== rightScore.score) {
      return rightScore.score - leftScore.score;
    }
    if (leftScore.updatedAt !== rightScore.updatedAt) {
      return rightScore.updatedAt - leftScore.updatedAt;
    }
    return left.seriesId.localeCompare(right.seriesId);
  })[0] ?? null;
}

export function getSourceForSeries(sourceSeriesId: string): string | null {
  return getSeriesMapping(sourceSeriesId)?.source ?? null;
}

export function resolveSourceForSeries(sourceSeriesId: string, fallbackSource?: string | null) {
  if (fallbackSource) {
    return fallbackSource;
  }

  return getSourceForSeries(sourceSeriesId) ?? null;
}

export async function ensureSeriesRecord(sourceSeriesId: string, detail?: SeriesDetail, sourceName?: string) {
  const src = resolveSourceForSeries(sourceSeriesId, sourceName);
  if (!src) {
    throw new Error(`Could not resolve source for series ${sourceSeriesId}`);
  }

  const existing = getSeriesMapping(sourceSeriesId, src);
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

  let remoteDetail = detail;
  if (!remoteDetail) {
    const source = getSource(src);
    if (!source) {
      throw new Error(`Unknown source: ${src}`);
    }
    remoteDetail = await source.getSeriesDetail(sourceSeriesId);
  }

  const sourceObj = getSource(src);
  const isNsfw = sourceObj?.isNsfw ?? false;
  const sourceKey = src as SourceName;
  const baseUrl = sourceObj?.baseUrl ?? "https://weebcentral.com";

  return getDb().transaction((tx) => {
    const concurrent = findSeriesMappingBySourceId(tx, sourceSeriesId, sourceKey);
    if (concurrent) {
      return concurrent.seriesId;
    }

    const now = new Date();
    const seriesId = crypto.randomUUID();

    tx
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
        adult: isNsfw ? true : remoteDetail.isAdult,
        authors: JSON.stringify(remoteDetail.authors ?? []),
        sourceTags: JSON.stringify(remoteDetail.tags ?? []),
        updatedAt: now,
      })
      .run();

    try {
      tx
        .insert(sourceMapping)
        .values({
          id: crypto.randomUUID(),
          seriesId,
          source: sourceKey,
          sourceSeriesId,
          sourceUrl: `${baseUrl}/series/${sourceSeriesId}/`,
        })
        .run();
    } catch (error) {
      tx.delete(series).where(eq(series.id, seriesId)).run();
      const winner = findSeriesMappingBySourceId(tx, sourceSeriesId, sourceKey);
      if (winner) {
        return winner.seriesId;
      }
      throw error;
    }

    return seriesId;
  });
}
