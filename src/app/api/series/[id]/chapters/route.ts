import { NextResponse } from "next/server";
import { and, eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { chapter, chapterProgress, sourceMapping } from "@/lib/db/schema";
import { getSource } from "@/lib/sources/registry";
import {
  getSeriesMapping as getSharedSeriesMapping,
  type SourceName,
} from "@/lib/library/shared";
import { warmFlareSolverrHeaders } from "@/lib/media/flaresolverr";
import "@/lib/sources/init";
import { logError, logWarn } from "@/lib/server/log";
import type { Chapter } from "@/lib/sources/types";

export const runtime = "nodejs";

export interface ChapterWithProgress extends Chapter {
  readState: "read" | "unread" | "in-progress";
  lastPage: number;
}

function getSeriesMapping(sourceSeriesId: string, sourceName: string) {
  return getDb()
    .select({ seriesId: sourceMapping.seriesId })
    .from(sourceMapping)
    .where(
      and(
        eq(sourceMapping.source, sourceName as SourceName),
        eq(sourceMapping.sourceSeriesId, sourceSeriesId),
      ),
    )
    .get();
}

function getProgressMap(seriesId: string): Map<string, { completed: boolean; lastPage: number }> {
  const rows = getDb()
    .select({
      sourceChapterId: chapter.sourceChapterId,
      lastPage: chapterProgress.lastPage,
      completed: chapterProgress.completed,
    })
    .from(chapterProgress)
    .innerJoin(chapter, eq(chapterProgress.chapterId, chapter.id))
    .where(eq(chapterProgress.seriesId, seriesId))
    .all();

  const map = new Map<string, { completed: boolean; lastPage: number }>();
  for (const row of rows) {
    map.set(row.sourceChapterId, {
      completed: row.completed ?? false,
      lastPage: row.lastPage ?? 0,
    });
  }
  return map;
}

function enrichWithProgress(chapters: Chapter[], seriesId: string | null): ChapterWithProgress[] {
  if (!seriesId) {
    return chapters.map((ch) => ({ ...ch, readState: "unread" as const, lastPage: 0 }));
  }

  const progressMap = getProgressMap(seriesId);

  return chapters.map((ch) => {
    const progress = progressMap.get(ch.sourceChapterId);
    let readState: "read" | "unread" | "in-progress" = "unread";
    if (progress?.completed) readState = "read";
    else if (progress && progress.lastPage > 0) readState = "in-progress";

    return {
      ...ch,
      readState,
      lastPage: progress?.lastPage ?? 0,
    };
  });
}

function getCachedChapters(sourceSeriesId: string, sourceName: string): Chapter[] | null {
  const mapping = getSeriesMapping(sourceSeriesId, sourceName);
  if (!mapping) return null;

  const rows = getDb()
    .select({
      sourceChapterId: chapter.sourceChapterId,
      chapterNo: chapter.chapterNo,
      title: chapter.title,
    })
    .from(chapter)
    .where(
      and(
        eq(chapter.seriesId, mapping.seriesId),
        eq(chapter.source, sourceName as SourceName),
      ),
    )
    .orderBy(asc(chapter.sortKey))
    .all();

  if (rows.length === 0) return null;

  return rows.map((row) => ({
    sourceChapterId: row.sourceChapterId,
    chapterNo: row.chapterNo,
    title: row.title ?? `Chapter ${row.chapterNo}`,
  }));
}

function updateCachedChapters(sourceSeriesId: string, chapters: Chapter[], sourceName: string) {
  const mapping = getSeriesMapping(sourceSeriesId, sourceName);
  if (!mapping) return;

  const now = new Date();

  for (const ch of chapters) {
    const existing = getDb()
      .select({ id: chapter.id })
      .from(chapter)
      .where(
        and(
          eq(chapter.seriesId, mapping.seriesId),
          eq(chapter.source, sourceName as SourceName),
          eq(chapter.sourceChapterId, ch.sourceChapterId),
        ),
      )
      .get();

    if (!existing) {
      getDb().insert(chapter).values({
        id: crypto.randomUUID(),
        seriesId: mapping.seriesId,
        source: sourceName as SourceName,
        sourceChapterId: ch.sourceChapterId,
        chapterNo: ch.chapterNo,
        title: ch.title,
        pageCount: 0,
        sortKey: ch.chapterNo,
        createdAt: now,
      }).run();
    }
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
  const seriesRequest = getSharedSeriesMapping(id, requestedSource ?? undefined);
  if (!seriesRequest && !requestedSource) {
    return NextResponse.json({ error: "Series source not found" }, { status: 404 });
  }
  const sourceSeriesId = seriesRequest?.sourceSeriesId ?? id;
  const sourceName = seriesRequest?.source ?? requestedSource;

  if (!sourceName) {
    return NextResponse.json({ error: "Series source not found" }, { status: 404 });
  }

  const mapping = getSeriesMapping(sourceSeriesId, sourceName);
  const seriesId = mapping?.seriesId ?? seriesRequest?.seriesId ?? null;

  // Try to serve from cache for library series (unless refresh forced)
  if (!forceRefresh) {
    const cached = getCachedChapters(sourceSeriesId, sourceName);
    if (cached) {
      void warmFlareSolverrHeaders(sourceName);
      return NextResponse.json(enrichWithProgress(cached, seriesId));
    }
  }

  // Fetch from source
  try {
    const source = getSource(sourceName);
    if (!source) {
      return NextResponse.json({ error: `Unknown source: ${sourceName}` }, { status: 400 });
    }
    const chapters = await source.getChapterList(sourceSeriesId);
    void warmFlareSolverrHeaders(sourceName);
    updateCachedChapters(sourceSeriesId, chapters, sourceName);
    // Re-read mapping in case it was created during update
    const freshMapping = getSeriesMapping(sourceSeriesId, sourceName);
    return NextResponse.json(enrichWithProgress(chapters, freshMapping?.seriesId ?? null));
  } catch (error) {
    const cached = getCachedChapters(sourceSeriesId, sourceName);
    if (cached) {
      logWarn("api.series.chapters.source_failed_using_cache", {
        sourceId: sourceSeriesId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json(enrichWithProgress(cached, seriesId));
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.series.chapters.failed", error, { sourceId: sourceSeriesId });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
