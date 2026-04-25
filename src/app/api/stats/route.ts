import { NextResponse } from "next/server";
import { and, count, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  chapter,
  chapterProgress,
  libraryEntry,
  series,
} from "@/lib/db/schema";
import { NextRequest } from "next/server";
import { handleApiError } from "@/lib/server/api";
import { isNsfwEnabled } from "@/lib/server/config";

export const runtime = "nodejs";

function toDayKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function shiftDays(base: Date, diffDays: number) {
  const next = new Date(base);
  next.setUTCDate(base.getUTCDate() + diffDays);
  return next;
}

function computeStreaks(dayKeys: string[], now: Date) {
  const sorted = [...new Set(dayKeys)].sort();
  if (sorted.length === 0) {
    return { current: 0, longest: 0 };
  }

  // Longest streak
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i - 1]}T00:00:00.000Z`);
    const expected = toDayKey(shiftDays(prev, 1));
    if (sorted[i] === expected) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }

  // Current streak: count back from today
  const daySet = new Set(sorted);
  let current = 0;
  while (daySet.has(toDayKey(shiftDays(now, -current)))) {
    current += 1;
  }

  return { current, longest };
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const now = new Date();
    const thirtyDaysAgo = shiftDays(now, -29);
    const includeNsfw =
      request.nextUrl.searchParams.get("nsfw") === "1" && isNsfwEnabled();

    // `series.adult` is nullable. `ne(adult, true)` → SQL `adult != 1`, and
    // `NULL != 1` is NULL (falsy), so rows with an unset `adult` would be
    // silently excluded. Treat NULL as "not adult" to match the historical
    // JS-side filter that only excluded `adult === true`.
    const notAdult = or(isNull(series.adult), eq(series.adult, false));

    // ── Total chapters completed ──
    const totalChaptersResult = db
      .select({ value: count() })
      .from(chapterProgress)
      .innerJoin(series, eq(chapterProgress.seriesId, series.id))
      .where(
        includeNsfw
          ? eq(chapterProgress.completed, true)
          : and(eq(chapterProgress.completed, true), notAdult),
      )
      .get();
    const totalChaptersRead = totalChaptersResult?.value ?? 0;

    // ── Total pages read (sum of pageCount for completed chapters) ──
    const totalPagesResult = db
      .select({ value: sql<number>`coalesce(sum(${chapter.pageCount}), 0)` })
      .from(chapterProgress)
      .innerJoin(chapter, eq(chapterProgress.chapterId, chapter.id))
      .innerJoin(series, eq(chapterProgress.seriesId, series.id))
      .where(
        includeNsfw
          ? eq(chapterProgress.completed, true)
          : and(eq(chapterProgress.completed, true), notAdult),
      )
      .get();
    const totalPagesRead = totalPagesResult?.value ?? 0;

    // ── Library counts ──
    const totalSeriesResult = db
      .select({ value: count() })
      .from(libraryEntry)
      .innerJoin(series, eq(libraryEntry.seriesId, series.id))
      .where(includeNsfw ? undefined : notAdult)
      .get();
    const totalSeriesInLibrary = totalSeriesResult?.value ?? 0;

    const totalCompletedResult = db
      .select({ value: count() })
      .from(libraryEntry)
      .innerJoin(series, eq(libraryEntry.seriesId, series.id))
      .where(
        includeNsfw
          ? eq(libraryEntry.status, "completed")
          : and(eq(libraryEntry.status, "completed"), notAdult),
      )
      .get();
    const totalSeriesCompleted = totalCompletedResult?.value ?? 0;

    // ── All completed chapter dates (for streaks + daily breakdown) ──
    // Push the adult-series filter into the WHERE via JOIN — previously we
    // loaded every completed row and filtered in JS, which scales poorly on
    // larger libraries.
    const completedRows = db
      .select({
        completedAt: chapterProgress.completedAt,
        seriesId: chapterProgress.seriesId,
        chapterId: chapterProgress.chapterId,
      })
      .from(chapterProgress)
      .innerJoin(series, eq(chapterProgress.seriesId, series.id))
      .where(
        includeNsfw
          ? and(eq(chapterProgress.completed, true), isNotNull(chapterProgress.completedAt))
          : and(
              eq(chapterProgress.completed, true),
              isNotNull(chapterProgress.completedAt),
              notAdult,
            ),
      )
      .all();

    const completedDates = completedRows
      .map((r) => r.completedAt)
      .filter((v): v is Date => v instanceof Date);

    const allDayKeys = completedDates.map(toDayKey);
    const { current: currentStreak, longest: longestStreak } = computeStreaks(allDayKeys, now);

    // ── Reading by day (last 30 days) ──
    // Build a map of date -> chapter IDs completed that day
    const last30Completions = completedRows.filter(
      (r) => r.completedAt instanceof Date && r.completedAt >= thirtyDaysAgo,
    );

    // Get page counts for these chapters
    const chapterIds = last30Completions.map((r) => r.chapterId);
    const pageCountMap = new Map<string, number>();
    if (chapterIds.length > 0) {
      const pageRows = db
        .select({ id: chapter.id, pageCount: chapter.pageCount })
        .from(chapter)
        .where(inArray(chapter.id, chapterIds))
        .all();
      for (const row of pageRows) {
        pageCountMap.set(row.id, row.pageCount ?? 0);
      }
    }

    const dailyMap = new Map<string, { chapters: number; pages: number }>();
    for (const row of last30Completions) {
      const day = toDayKey(row.completedAt as Date);
      const entry = dailyMap.get(day) ?? { chapters: 0, pages: 0 };
      entry.chapters += 1;
      entry.pages += pageCountMap.get(row.chapterId) ?? 0;
      dailyMap.set(day, entry);
    }

    const readingByDay: Array<{ date: string; chapters: number; pages: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const date = toDayKey(shiftDays(now, -i));
      const entry = dailyMap.get(date);
      readingByDay.push({
        date,
        chapters: entry?.chapters ?? 0,
        pages: entry?.pages ?? 0,
      });
    }

    const totalLast30 = readingByDay.reduce((sum, d) => sum + d.chapters, 0);
    const averageChaptersPerDay = Number((totalLast30 / 30).toFixed(2));

    // ── Reading by day of week ──
    const dowMap = new Map<number, number>();
    for (const date of completedDates) {
      const dow = date.getUTCDay();
      dowMap.set(dow, (dowMap.get(dow) ?? 0) + 1);
    }
    const readingByDayOfWeek = DAY_NAMES.map((day, i) => ({
      day,
      chapters: dowMap.get(i) ?? 0,
    }));

    // ── Top series by completed chapter count ──
    const topSeriesRows = db
      .select({
        seriesId: chapterProgress.seriesId,
        title: series.title,
        coverUrl: series.coverUrl,
        chaptersRead: count(),
      })
      .from(chapterProgress)
      .innerJoin(series, eq(chapterProgress.seriesId, series.id))
      .where(
        includeNsfw
          ? eq(chapterProgress.completed, true)
          : and(eq(chapterProgress.completed, true), notAdult),
      )
      .groupBy(chapterProgress.seriesId)
      .orderBy(desc(count()))
      .limit(10)
      .all();

    const topSeries = topSeriesRows.map((r) => ({
      seriesId: r.seriesId,
      title: r.title,
      coverUrl: r.coverUrl,
      chaptersRead: r.chaptersRead,
    }));

    // ── Status distribution ──
    const statusRows = db
      .select({
        status: libraryEntry.status,
        count: count(),
      })
      .from(libraryEntry)
      .innerJoin(series, eq(libraryEntry.seriesId, series.id))
      .where(includeNsfw ? undefined : notAdult)
      .groupBy(libraryEntry.status)
      .all();
    const statusDistribution = statusRows.map((r) => ({
      status: r.status,
      count: r.count,
    }));

    // ── Recent activity (last 20 completed chapters) ──
    const recentRows = db
      .select({
        completedAt: chapterProgress.completedAt,
        seriesTitle: series.title,
        chapterNo: chapter.chapterNo,
        chapterTitle: chapter.title,
      })
      .from(chapterProgress)
      .innerJoin(series, eq(chapterProgress.seriesId, series.id))
      .innerJoin(chapter, eq(chapterProgress.chapterId, chapter.id))
      .where(
        includeNsfw
          ? and(eq(chapterProgress.completed, true), isNotNull(chapterProgress.completedAt))
          : and(eq(chapterProgress.completed, true), isNotNull(chapterProgress.completedAt), notAdult),
      )
      .orderBy(desc(chapterProgress.completedAt))
      .limit(20)
      .all();

    const recentActivity = recentRows.map((r) => ({
      date: r.completedAt ? r.completedAt.toISOString() : "",
      seriesTitle: r.seriesTitle,
      chapterTitle: r.chapterTitle ?? `Chapter ${r.chapterNo}`,
      type: "chapter_completed",
    }));

    return NextResponse.json({
      totalChaptersRead,
      totalPagesRead,
      totalSeriesInLibrary,
      totalSeriesCompleted,
      averageChaptersPerDay,
      currentStreak,
      longestStreak,
      readingByDay,
      readingByDayOfWeek,
      topSeries,
      statusDistribution,
      recentActivity,
    });
  } catch (error) {
    return handleApiError("api.stats.failed", error, { url: request.url });
  }
}
