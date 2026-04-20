import { and, count, desc, eq, inArray, max } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  chapter,
  chapterProgress,
  libraryEntry,
  mediaCache,
  readingProgress,
  series,
  seriesTag,
  sourceMapping,
} from "@/lib/db/schema";
import type { Chapter, SeriesDetail } from "@/lib/sources/types";
import { ensureSeriesRecord, getSeriesMapping, type SourceName } from "./shared";

export type LibraryStatus =
  | "reading"
  | "completed"
  | "paused"
  | "dropped"
  | "rereading"
  | "planning";

export interface LibraryEntryRecord {
  seriesId: string;
  sourceSeriesId: string;
  source: string | null;
  title: string;
  coverUrl: string | null;
  status: LibraryStatus;
  addedAt: string | null;
  updatedAt: string | null;
  currentPage: number | null;
  progressUpdatedAt: string | null;
  currentChapterSourceId: string | null;
  currentChapterTitle: string | null;
  totalChapters: number;
  completedChapters: number;
  unreadChapters: number;
  downloadedChapters: number;
  lastCompletedAt: string | null;
  lastCompletedChapterSourceId: string | null;
  lastCompletedChapterTitle: string | null;
  /** Unix ms of the newest chapter's publishedAt across any source mapping. */
  latestChapterPublishedAt: number | null;
  tagIds: string[];
  adult: boolean;
}

export interface UpsertLibraryEntryInput {
  sourceSeriesId: string;
  status: LibraryStatus;
  seriesDetail?: SeriesDetail;
  chapters?: Pick<Chapter, "sourceChapterId" | "chapterNo" | "title" | "publishedAt">[];
  sourceName?: string;
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

interface LibraryEntryAggregate {
  totalChapters: number;
  completedChapters: number;
  downloadedChapters: number;
  lastCompletedAt: Date | null;
  lastCompletedChapterSourceId: string | null;
  lastCompletedChapterTitle: string | null;
  latestChapterPublishedAt: Date | null;
  tagIds: string[];
}

function mapRowToEntry(row: {
  seriesId: string;
  sourceSeriesId: string;
  source: string | null;
  title: string;
  coverUrl: string | null;
  status: LibraryStatus;
  addedAt: Date | null;
  updatedAt: Date | null;
  currentPage: number | null;
  progressUpdatedAt: Date | null;
  currentChapterSourceId: string | null;
  currentChapterTitle: string | null;
  totalChapters: number;
  completedChapters: number;
  downloadedChapters: number;
  lastCompletedAt: Date | null;
  lastCompletedChapterSourceId: string | null;
  lastCompletedChapterTitle: string | null;
  latestChapterPublishedAt: Date | null;
  tagIds: string[];
  adult: boolean;
}): LibraryEntryRecord {
  return {
    seriesId: row.seriesId,
    sourceSeriesId: row.sourceSeriesId,
    source: row.source,
    title: row.title,
    coverUrl: row.coverUrl,
    status: row.status,
    addedAt: toIsoString(row.addedAt),
    updatedAt: toIsoString(row.updatedAt),
    currentPage: row.currentPage,
    progressUpdatedAt: toIsoString(row.progressUpdatedAt),
    currentChapterSourceId: row.currentChapterSourceId,
    currentChapterTitle: row.currentChapterTitle,
    totalChapters: row.totalChapters,
    completedChapters: row.completedChapters,
    unreadChapters: Math.max(row.totalChapters - row.completedChapters, 0),
    downloadedChapters: row.downloadedChapters,
    lastCompletedAt: toIsoString(row.lastCompletedAt),
    lastCompletedChapterSourceId: row.lastCompletedChapterSourceId,
    lastCompletedChapterTitle: row.lastCompletedChapterTitle,
    latestChapterPublishedAt: row.latestChapterPublishedAt ? row.latestChapterPublishedAt.getTime() : null,
    tagIds: row.tagIds,
    adult: row.adult,
  };
}

function ensureChapterCatalog(
  seriesId: string,
  chapters: Pick<Chapter, "sourceChapterId" | "chapterNo" | "title" | "publishedAt">[],
  sourceName: string,
) {
  if (chapters.length === 0) {
    return;
  }

  const dedupedChapters = Array.from(
    new Map(chapters.map((chapterItem) => [chapterItem.sourceChapterId, chapterItem])).values(),
  );
  const sourceChapterIds = dedupedChapters.map((chapterItem) => chapterItem.sourceChapterId);
  const existingChapterIds = new Set(
    getDb()
      .select({ sourceChapterId: chapter.sourceChapterId })
      .from(chapter)
      .where(
        and(
          eq(chapter.seriesId, seriesId),
          eq(chapter.source, sourceName),
          inArray(chapter.sourceChapterId, sourceChapterIds),
        ),
      )
      .all()
      .map((row) => row.sourceChapterId),
  );

  const missingChapters = dedupedChapters.filter(
    (chapterItem) => !existingChapterIds.has(chapterItem.sourceChapterId),
  );
  if (missingChapters.length === 0) {
    return;
  }

  const now = new Date();

  getDb()
    .insert(chapter)
    .values(
      missingChapters.map((chapterItem) => ({
        id: crypto.randomUUID(),
        seriesId,
        source: sourceName,
        sourceChapterId: chapterItem.sourceChapterId,
        chapterNo: chapterItem.chapterNo,
        title: chapterItem.title,
        pageCount: 0,
        publishedAt: chapterItem.publishedAt != null ? new Date(chapterItem.publishedAt) : null,
        sortKey: chapterItem.chapterNo,
        createdAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [chapter.seriesId, chapter.source, chapter.sourceChapterId],
    })
    .run();
}

function buildDefaultAggregate(): LibraryEntryAggregate {
  return {
    totalChapters: 0,
    completedChapters: 0,
    downloadedChapters: 0,
    lastCompletedAt: null,
    lastCompletedChapterSourceId: null,
    lastCompletedChapterTitle: null,
    latestChapterPublishedAt: null,
    tagIds: [],
  };
}

function getLibraryEntryAggregates(seriesIds: string[]) {
  const aggregateMap = new Map<string, LibraryEntryAggregate>(
    seriesIds.map((seriesId) => [seriesId, buildDefaultAggregate()]),
  );

  if (seriesIds.length === 0) {
    return aggregateMap;
  }

  const totalChapterRows = getDb()
    .select({
      seriesId: chapter.seriesId,
      value: count(),
    })
    .from(chapter)
    .where(inArray(chapter.seriesId, seriesIds))
    .groupBy(chapter.seriesId)
    .all();

  for (const row of totalChapterRows) {
    const aggregate = aggregateMap.get(row.seriesId);
    if (aggregate) {
      aggregate.totalChapters = row.value;
    }
  }

  const completedChapterRows = getDb()
    .select({
      seriesId: chapterProgress.seriesId,
      value: count(),
    })
    .from(chapterProgress)
    .where(
      and(
        inArray(chapterProgress.seriesId, seriesIds),
        eq(chapterProgress.completed, true),
      ),
    )
    .groupBy(chapterProgress.seriesId)
    .all();

  for (const row of completedChapterRows) {
    const aggregate = aggregateMap.get(row.seriesId);
    if (aggregate) {
      aggregate.completedChapters = row.value;
    }
  }

  const downloadedChapterRows = getDb()
    .select({
      seriesId: chapter.seriesId,
      value: count(),
    })
    .from(mediaCache)
    .innerJoin(chapter, eq(mediaCache.chapterId, chapter.id))
    .where(
      and(
        inArray(chapter.seriesId, seriesIds),
        eq(mediaCache.state, "ready"),
      ),
    )
    .groupBy(chapter.seriesId)
    .all();

  for (const row of downloadedChapterRows) {
    const aggregate = aggregateMap.get(row.seriesId);
    if (aggregate) {
      aggregate.downloadedChapters = row.value;
    }
  }

  const lastCompletedRows = getDb()
    .select({
      seriesId: chapterProgress.seriesId,
      completedAt: chapterProgress.completedAt,
      sourceChapterId: chapter.sourceChapterId,
      title: chapter.title,
    })
    .from(chapterProgress)
    .innerJoin(chapter, eq(chapterProgress.chapterId, chapter.id))
    .where(
      and(
        inArray(chapterProgress.seriesId, seriesIds),
        eq(chapterProgress.completed, true),
      ),
    )
    .orderBy(desc(chapterProgress.completedAt))
    .all();

  for (const row of lastCompletedRows) {
    const aggregate = aggregateMap.get(row.seriesId);
    if (!aggregate || aggregate.lastCompletedAt) {
      continue;
    }

    aggregate.lastCompletedAt = row.completedAt;
    aggregate.lastCompletedChapterSourceId = row.sourceChapterId;
    aggregate.lastCompletedChapterTitle = row.title;
  }

  // Newest chapter publishedAt per series — drives the "fresh" tick on library
  // cards and the caught-up relative label. Series with no dated chapters stay null.
  const latestPublishedRows = getDb()
    .select({
      seriesId: chapter.seriesId,
      value: max(chapter.publishedAt),
    })
    .from(chapter)
    .where(inArray(chapter.seriesId, seriesIds))
    .groupBy(chapter.seriesId)
    .all();

  for (const row of latestPublishedRows) {
    const aggregate = aggregateMap.get(row.seriesId);
    if (aggregate && row.value != null) {
      // drizzle returns timestamp-mode columns as Date; max() may return a raw
      // number (unix seconds from better-sqlite3). Normalise both.
      aggregate.latestChapterPublishedAt =
        row.value instanceof Date ? row.value : new Date(Number(row.value) * 1000);
    }
  }

  const tagRows = getDb()
    .select({
      seriesId: seriesTag.seriesId,
      tagId: seriesTag.tagId,
    })
    .from(seriesTag)
    .where(inArray(seriesTag.seriesId, seriesIds))
    .all();

  for (const row of tagRows) {
    const aggregate = aggregateMap.get(row.seriesId);
    if (aggregate) {
      aggregate.tagIds.push(row.tagId);
    }
  }

  return aggregateMap;
}

function buildLibraryEntry(baseRow: {
  sourceSeriesId: string;
  source: string | null;
  title: string;
  coverUrl: string | null;
  status: LibraryStatus;
  addedAt: Date | null;
  updatedAt: Date | null;
  currentPage: number | null;
  progressUpdatedAt: Date | null;
  currentChapterSourceId: string | null;
  currentChapterTitle: string | null;
  seriesId: string;
  adult: boolean;
}, aggregate: LibraryEntryAggregate) {
  return mapRowToEntry({
    ...baseRow,
    totalChapters: aggregate.totalChapters,
    completedChapters: aggregate.completedChapters,
    downloadedChapters: aggregate.downloadedChapters,
    lastCompletedAt: aggregate.lastCompletedAt,
    lastCompletedChapterSourceId: aggregate.lastCompletedChapterSourceId,
    lastCompletedChapterTitle: aggregate.lastCompletedChapterTitle,
    latestChapterPublishedAt: aggregate.latestChapterPublishedAt,
    tagIds: aggregate.tagIds,
    adult: baseRow.adult,
  });
}

export function getLibraryEntry(sourceSeriesId: string, sourceName?: string) {
  const mapping = getSeriesMapping(sourceSeriesId, sourceName);
  if (!mapping) {
    return null;
  }

  const row = getDb()
    .select({
      seriesId: series.id,
      sourceSeriesId: sourceMapping.sourceSeriesId,
      source: sourceMapping.source,
      title: series.title,
      coverUrl: series.coverUrl,
      adult: series.adult,
      status: libraryEntry.status,
      addedAt: libraryEntry.addedAt,
      updatedAt: libraryEntry.updatedAt,
      currentPage: readingProgress.currentPage,
      progressUpdatedAt: readingProgress.updatedAt,
      currentChapterSourceId: chapter.sourceChapterId,
      currentChapterTitle: chapter.title,
    })
    .from(sourceMapping)
    .innerJoin(series, eq(sourceMapping.seriesId, series.id))
    .innerJoin(libraryEntry, eq(libraryEntry.seriesId, series.id))
    .leftJoin(readingProgress, eq(readingProgress.seriesId, series.id))
    .leftJoin(chapter, eq(readingProgress.currentChapterId, chapter.id))
    .where(
      and(
        eq(sourceMapping.source, mapping.source as SourceName),
        eq(sourceMapping.seriesId, mapping.seriesId),
      ),
    )
    .get();

  if (!row) {
    return null;
  }

  const aggregate = getLibraryEntryAggregates([row.seriesId]).get(row.seriesId) ?? buildDefaultAggregate();
  return buildLibraryEntry({ ...row, adult: row.adult ?? false }, aggregate);
}

export function setLibraryEntryAdult(sourceSeriesId: string, adult: boolean, sourceName?: string) {
  const mapping = getSeriesMapping(sourceSeriesId, sourceName);
  if (!mapping) {
    throw new Error("Library entry not found");
  }

  const existing = getDb()
    .select({ seriesId: libraryEntry.seriesId })
    .from(libraryEntry)
    .where(eq(libraryEntry.seriesId, mapping.seriesId))
    .get();

  if (!existing) {
    throw new Error("Library entry not found");
  }

  getDb()
    .update(series)
    .set({
      adult,
      updatedAt: new Date(),
    })
    .where(eq(series.id, mapping.seriesId))
    .run();

  const entry = getLibraryEntry(mapping.sourceSeriesId, sourceName);
  if (!entry) {
    throw new Error("Library entry not found");
  }

  return entry;
}

export async function upsertLibraryEntry(input: UpsertLibraryEntryInput) {
  const sourceName =
    input.sourceName ?? input.seriesDetail?.source ?? getSeriesMapping(input.sourceSeriesId)?.source;
  if (!sourceName) {
    throw new Error(`Could not resolve source for series ${input.sourceSeriesId}`);
  }

  const seriesId = await ensureSeriesRecord(input.sourceSeriesId, input.seriesDetail, sourceName);
  const now = new Date();

  if (input.chapters && input.chapters.length > 0) {
    ensureChapterCatalog(seriesId, input.chapters, sourceName);
  }

  getDb()
    .insert(libraryEntry)
    .values({
      seriesId,
      status: input.status,
      addedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: libraryEntry.seriesId,
      set: {
        status: input.status,
        updatedAt: now,
      },
    })
    .run();

  return getLibraryEntry(input.sourceSeriesId, sourceName);
}

export function listLibraryEntries(opts?: { includeNsfw?: boolean }) {
  const rows = getDb()
    .select({
      seriesId: series.id,
      sourceSeriesId: sourceMapping.sourceSeriesId,
      source: sourceMapping.source,
      title: series.title,
      coverUrl: series.coverUrl,
      adult: series.adult,
      status: libraryEntry.status,
      addedAt: libraryEntry.addedAt,
      updatedAt: libraryEntry.updatedAt,
      currentPage: readingProgress.currentPage,
      progressUpdatedAt: readingProgress.updatedAt,
      currentChapterSourceId: chapter.sourceChapterId,
      currentChapterTitle: chapter.title,
    })
    .from(libraryEntry)
    .innerJoin(series, eq(libraryEntry.seriesId, series.id))
    .innerJoin(
      sourceMapping,
      eq(sourceMapping.seriesId, series.id),
    )
    .leftJoin(readingProgress, eq(readingProgress.seriesId, series.id))
    .leftJoin(chapter, eq(readingProgress.currentChapterId, chapter.id))
    .orderBy(desc(libraryEntry.updatedAt), desc(libraryEntry.addedAt))
    .all();

  // Deduplicate: a series may have multiple source mappings — keep first per seriesId
  const seen = new Set<string>();
  const deduped = rows.filter((row) => {
    if (seen.has(row.seriesId)) return false;
    seen.add(row.seriesId);
    return true;
  });

  // Apply NSFW filter client-side after dedup
  const filtered = opts?.includeNsfw ? deduped : deduped.filter((row) => !row.adult);
  const aggregateMap = getLibraryEntryAggregates(filtered.map((row) => row.seriesId));

  return filtered.map((row) =>
    buildLibraryEntry(
      { ...row, adult: row.adult ?? false },
      aggregateMap.get(row.seriesId) ?? buildDefaultAggregate(),
    ),
  );
}

export function removeLibraryEntry(sourceSeriesId: string, sourceName?: string) {
  const mapping = getSeriesMapping(sourceSeriesId, sourceName);
  if (!mapping) return;

  const { seriesId } = mapping;

  // Delete library entry
  getDb().delete(libraryEntry).where(eq(libraryEntry.seriesId, seriesId)).run();

  // Delete tag associations
  getDb().delete(seriesTag).where(eq(seriesTag.seriesId, seriesId)).run();
}
