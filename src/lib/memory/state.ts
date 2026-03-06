import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
    activityEvent,
    chapter,
    chapterProgress,
    series,
    sourceMapping,
} from "@/lib/db/schema";
import { SOURCE } from "@/lib/library/shared";

export interface ActivityTimelineItem {
    id: string;
    type: string;
    createdAt: string | null;
    sourceSeriesId: string | null;
    sourceChapterId: string | null;
    seriesTitle: string | null;
    chapterTitle: string | null;
    payload: unknown;
}

export interface ReadingStats {
    completedChaptersTotal: number;
    completedChaptersLast30Days: number;
    chaptersPerDayLast30Days: number;
    activeDaysLast30Days: number;
    currentStreakDays: number;
    bestStreakDays: number;
    monthlySummaries: Array<{
        month: string;
        completedChapters: number;
    }>;
}

export interface MemoryOverview {
    timeline: ActivityTimelineItem[];
    stats: ReadingStats;
}

export function logActivityEvent(input: {
    type: string;
    seriesId?: string | null;
    chapterId?: string | null;
    payload?: unknown;
}) {
    let payload = null as string | null;
    if (input.payload !== undefined) {
        try {
            payload = JSON.stringify(input.payload);
        } catch {
            payload = null;
        }
    }

    getDb()
        .insert(activityEvent)
        .values({
            type: input.type,
            seriesId: input.seriesId ?? null,
            chapterId: input.chapterId ?? null,
            payload,
            createdAt: new Date(),
        })
        .run();
}

function toIsoString(value: Date | null | undefined) {
    return value ? value.toISOString() : null;
}

function toDayKey(value: Date) {
    return value.toISOString().slice(0, 10);
}

function toMonthKey(value: Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftDays(base: Date, diffDays: number) {
    const next = new Date(base);
    next.setUTCDate(base.getUTCDate() + diffDays);
    return next;
}

function parsePayload(payload: string | null) {
    if (!payload) {
        return null;
    }

    try {
        return JSON.parse(payload);
    } catch {
        return payload;
    }
}

function computeBestStreak(dayKeys: string[]) {
    if (dayKeys.length === 0) {
        return 0;
    }

    const sorted = [...new Set(dayKeys)].sort();
    let best = 1;
    let current = 1;

    for (let index = 1; index < sorted.length; index += 1) {
        const prev = new Date(`${sorted[index - 1]}T00:00:00.000Z`);
        const expected = toDayKey(shiftDays(prev, 1));

        if (sorted[index] === expected) {
            current += 1;
            if (current > best) {
                best = current;
            }
            continue;
        }

        current = 1;
    }

    return best;
}

function computeCurrentStreak(daySet: Set<string>, now: Date) {
    let streak = 0;

    while (true) {
        const candidate = toDayKey(shiftDays(now, -streak));
        if (!daySet.has(candidate)) {
            break;
        }
        streak += 1;
    }

    return streak;
}

export function getActivityTimeline(limit = 40, options?: { includeNsfw?: boolean }): ActivityTimelineItem[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);

    let query = getDb()
        .select({
            id: activityEvent.id,
            type: activityEvent.type,
            createdAt: activityEvent.createdAt,
            payload: activityEvent.payload,
            sourceSeriesId: sourceMapping.sourceSeriesId,
            sourceChapterId: chapter.sourceChapterId,
            seriesTitle: series.title,
            chapterTitle: chapter.title,
        })
        .from(activityEvent)
        .leftJoin(series, eq(activityEvent.seriesId, series.id))
        .leftJoin(chapter, eq(activityEvent.chapterId, chapter.id))
        .leftJoin(
            sourceMapping,
            and(eq(sourceMapping.seriesId, activityEvent.seriesId), eq(sourceMapping.source, SOURCE)),
        );

    if (options?.includeNsfw === false) {
        query = query.where(eq(series.adult, false)) as typeof query;
    }

    return query
        .orderBy(desc(activityEvent.createdAt))
        .limit(safeLimit)
        .all()
        .map((row) => ({
            id: row.id,
            type: row.type,
            createdAt: toIsoString(row.createdAt),
            payload: parsePayload(row.payload),
            sourceSeriesId: row.sourceSeriesId ?? null,
            sourceChapterId: row.sourceChapterId ?? null,
            seriesTitle: row.seriesTitle ?? null,
            chapterTitle: row.chapterTitle ?? null,
        }));
}

export function getReadingStats(options?: { includeNsfw?: boolean }): ReadingStats {
    const now = new Date();
    const start30 = shiftDays(now, -29);

    let query = getDb()
        .select({ completedAt: chapterProgress.completedAt })
        .from(chapterProgress)
        .innerJoin(series, eq(chapterProgress.seriesId, series.id));

    const baseCondition = and(eq(chapterProgress.completed, true), isNotNull(chapterProgress.completedAt));

    if (options?.includeNsfw === false) {
        query = query.where(and(baseCondition, eq(series.adult, false))) as typeof query;
    } else {
        query = query.where(baseCondition) as typeof query;
    }

    const rows = query
        .all()
        .map((row) => row.completedAt)
        .filter((value): value is Date => value instanceof Date);

    const completedDayKeys = rows.map(toDayKey);
    const completedDaySet = new Set(completedDayKeys);
    const completedLast30 = rows.filter((value) => value >= start30);
    const completedLast30DaySet = new Set(completedLast30.map(toDayKey));

    const monthlyKeys: string[] = [];
    for (let index = 5; index >= 0; index -= 1) {
        monthlyKeys.push(toMonthKey(shiftDays(now, -index * 30)));
    }

    const monthlyCounts = new Map<string, number>();
    for (const completedAt of rows) {
        const month = toMonthKey(completedAt);
        monthlyCounts.set(month, (monthlyCounts.get(month) ?? 0) + 1);
    }

    return {
        completedChaptersTotal: rows.length,
        completedChaptersLast30Days: completedLast30.length,
        chaptersPerDayLast30Days: Number((completedLast30.length / 30).toFixed(2)),
        activeDaysLast30Days: completedLast30DaySet.size,
        currentStreakDays: computeCurrentStreak(completedDaySet, now),
        bestStreakDays: computeBestStreak(completedDayKeys),
        monthlySummaries: monthlyKeys.map((month) => ({
            month,
            completedChapters: monthlyCounts.get(month) ?? 0,
        })),
    };
}

export function getMemoryOverview(limit = 40, options?: { includeNsfw?: boolean }): MemoryOverview {
    return {
        timeline: getActivityTimeline(limit, options),
        stats: getReadingStats(options),
    };
}
