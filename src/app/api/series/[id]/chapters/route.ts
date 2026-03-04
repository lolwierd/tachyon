import { NextResponse } from "next/server";
import { and, eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { chapter, chapterProgress, sourceMapping } from "@/lib/db/schema";
import { getChapterList } from "@/lib/sources/weebcentral";
import { logError, logWarn } from "@/lib/server/log";
import type { Chapter } from "@/lib/sources/types";

export const runtime = "nodejs";

const SOURCE = "weebcentral" as const;

export interface ChapterWithProgress extends Chapter {
  readState: "read" | "unread" | "in-progress";
  lastPage: number;
}

function getSeriesMapping(sourceSeriesId: string) {
  return getDb()
    .select({ seriesId: sourceMapping.seriesId })
    .from(sourceMapping)
    .where(
      and(
        eq(sourceMapping.source, SOURCE),
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

function getCachedChapters(sourceSeriesId: string): Chapter[] | null {
  const mapping = getSeriesMapping(sourceSeriesId);
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
        eq(chapter.source, SOURCE),
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

function updateCachedChapters(sourceSeriesId: string, chapters: Chapter[]) {
  const mapping = getSeriesMapping(sourceSeriesId);
  if (!mapping) return;

  const now = new Date();

  for (const ch of chapters) {
    const existing = getDb()
      .select({ id: chapter.id })
      .from(chapter)
      .where(
        and(
          eq(chapter.seriesId, mapping.seriesId),
          eq(chapter.source, SOURCE),
          eq(chapter.sourceChapterId, ch.sourceChapterId),
        ),
      )
      .get();

    if (!existing) {
      getDb().insert(chapter).values({
        id: crypto.randomUUID(),
        seriesId: mapping.seriesId,
        source: SOURCE,
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

  const mapping = getSeriesMapping(id);
  const seriesId = mapping?.seriesId ?? null;

  // Try to serve from cache for library series (unless refresh forced)
  if (!forceRefresh) {
    const cached = getCachedChapters(id);
    if (cached) {
      return NextResponse.json(enrichWithProgress(cached, seriesId));
    }
  }

  // Fetch from source
  try {
    const chapters = await getChapterList(id);
    updateCachedChapters(id, chapters);
    // Re-read mapping in case it was created during update
    const freshMapping = getSeriesMapping(id);
    return NextResponse.json(enrichWithProgress(chapters, freshMapping?.seriesId ?? null));
  } catch (error) {
    const cached = getCachedChapters(id);
    if (cached) {
      logWarn("api.series.chapters.source_failed_using_cache", {
        sourceId: id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json(enrichWithProgress(cached, seriesId));
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.series.chapters.failed", error, { sourceId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
