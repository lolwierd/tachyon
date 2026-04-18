import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { libraryEntry, sourceMapping, updateSchedule } from "@/lib/db/schema";
import { SOURCE } from "@/lib/library/shared";
import { listLibraryEntries } from "@/lib/library/state";
import { enqueueUpdateRun } from "@/lib/background/enqueue";
import { listActiveRuns, requestCancelRun, type RunTrigger } from "@/lib/background/queue";
import { logError, logWarn } from "@/lib/server/log";
import { isNsfwEnabled } from "@/lib/server/config";

export type UpdateTargetType = "all" | "status_bucket" | "smart_unread";

export interface UpdateRuleInput {
  name: string;
  enabled: boolean;
  targetType: UpdateTargetType;
  targetValue?: unknown;
  intervalMinutes: number;
  jitterSeconds?: number;
}

function now() {
  return new Date();
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function computeNextRunAt(intervalMinutes: number, jitterSeconds: number) {
  const baseMs = Math.max(Math.trunc(intervalMinutes), 1) * 60 * 1000;
  const jitterMs = Math.max(Math.trunc(jitterSeconds), 0) * 1000;
  const randomJitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
  return new Date(Date.now() + baseMs + randomJitter);
}

function normalizeInterval(value: number) {
  if (!Number.isFinite(value)) return 60;
  return Math.min(Math.max(Math.trunc(value), 1), 24 * 60);
}

function normalizeJitter(value: number | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) return 0;
  return Math.min(Math.max(Math.trunc(value ?? 0), 0), 3600);
}

export function listUpdateSchedules() {
  return getDb().select()
    .from(updateSchedule)
    .orderBy(desc(updateSchedule.createdAt))
    .all()
    .map((row) => ({
      ...row,
      targetValue: parseJson(row.targetValueJson),
    }));
}

export function createUpdateSchedule(input: UpdateRuleInput) {
  const timestamp = now();
  const intervalMinutes = normalizeInterval(input.intervalMinutes);
  const jitterSeconds = normalizeJitter(input.jitterSeconds);
  const id = crypto.randomUUID();

  getDb().insert(updateSchedule).values({
    id,
    name: input.name,
    enabled: input.enabled,
    targetType: input.targetType,
    targetValueJson: input.targetValue != null ? JSON.stringify(input.targetValue) : null,
    intervalMinutes,
    jitterSeconds,
    nextRunAt: input.enabled ? computeNextRunAt(intervalMinutes, jitterSeconds) : null,
    overlapPolicy: "cancel_old_start_new",
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();

  return getUpdateSchedule(id);
}

export function getUpdateSchedule(id: string) {
  const row = getDb().select().from(updateSchedule).where(eq(updateSchedule.id, id)).get();
  if (!row) {
    return null;
  }

  return {
    ...row,
    targetValue: parseJson(row.targetValueJson),
  };
}

export function patchUpdateSchedule(id: string, input: Partial<UpdateRuleInput>) {
  const existing = getUpdateSchedule(id);
  if (!existing) {
    return null;
  }

  const intervalMinutes = normalizeInterval(input.intervalMinutes ?? existing.intervalMinutes);
  const jitterSeconds = normalizeJitter(input.jitterSeconds ?? existing.jitterSeconds);
  const enabled = input.enabled ?? existing.enabled;

  getDb().update(updateSchedule)
    .set({
      name: input.name ?? existing.name,
      enabled,
      targetType: input.targetType ?? existing.targetType,
      targetValueJson: input.targetValue !== undefined
        ? JSON.stringify(input.targetValue)
        : existing.targetValueJson,
      intervalMinutes,
      jitterSeconds,
      nextRunAt: enabled
        ? (existing.nextRunAt ?? computeNextRunAt(intervalMinutes, jitterSeconds))
        : null,
      updatedAt: now(),
    })
    .where(eq(updateSchedule.id, id))
    .run();

  return getUpdateSchedule(id);
}

export function deleteUpdateSchedule(id: string) {
  getDb().delete(updateSchedule).where(eq(updateSchedule.id, id)).run();
}

function resolveSeriesIdsForRule(rule: {
  targetType: UpdateTargetType;
  targetValueJson: string | null;
}) {
  if (rule.targetType === "all") {
    return getDb().selectDistinct({ sourceSeriesId: sourceMapping.sourceSeriesId })
      .from(libraryEntry)
      .innerJoin(sourceMapping, and(eq(sourceMapping.seriesId, libraryEntry.seriesId), eq(sourceMapping.source, SOURCE)))
      .all()
      .map((row) => row.sourceSeriesId);
  }

  if (rule.targetType === "status_bucket") {
    const value = parseJson(rule.targetValueJson);
    const statuses = Array.isArray((value as { statuses?: unknown })?.statuses)
      ? (value as { statuses: string[] }).statuses
      : [];

    if (statuses.length === 0) {
      return [];
    }

    return getDb().selectDistinct({ sourceSeriesId: sourceMapping.sourceSeriesId })
      .from(libraryEntry)
      .innerJoin(sourceMapping, and(eq(sourceMapping.seriesId, libraryEntry.seriesId), eq(sourceMapping.source, SOURCE)))
      .where(inArray(libraryEntry.status, statuses as typeof libraryEntry.status.enumValues))
      .all()
      .map((row) => row.sourceSeriesId);
  }

  // smart_unread — include NSFW entries so they get updated too, but
  // only when the global NSFW kill switch is on. With it off, the
  // scraper isn't even registered, so queueing an adult-series refresh
  // would just log "no source for …" errors.
  return listLibraryEntries({ includeNsfw: isNsfwEnabled() })
    .filter((entry) => entry.unreadChapters > 0 && entry.status !== "completed" && entry.status !== "dropped")
    .map((entry) => entry.sourceSeriesId);
}

function parseScope(value: string | null | undefined) {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  return parsed as {
    scheduleId?: string | null;
  };
}

function cancelOverlappingScheduleRuns(scheduleId: string) {
  const runs = listActiveRuns("update");
  for (const run of runs) {
    const scope = parseScope(run.scopeJson);
    if (scope?.scheduleId === scheduleId) {
      requestCancelRun(run.id);
    }
  }
}

export function runUpdateRuleNow(scheduleId: string, trigger: RunTrigger = "manual") {
  const schedule = getUpdateSchedule(scheduleId);
  if (!schedule) {
    return null;
  }

  if (schedule.overlapPolicy === "cancel_old_start_new") {
    cancelOverlappingScheduleRuns(scheduleId);
  }

  const sourceSeriesIds = resolveSeriesIdsForRule(schedule);
  const run = enqueueUpdateRun({
    sourceSeriesIds,
    trigger,
    reason: `schedule:${scheduleId}`,
    scheduleId,
  });

  getDb().update(updateSchedule)
    .set({
      lastRunId: run?.id ?? null,
      lastRunAt: now(),
      nextRunAt: schedule.enabled ? computeNextRunAt(schedule.intervalMinutes, schedule.jitterSeconds) : null,
      updatedAt: now(),
    })
    .where(eq(updateSchedule.id, scheduleId))
    .run();

  return run;
}

export function processDueUpdateSchedules() {
  const due = getDb().select()
    .from(updateSchedule)
    .where(
      and(
        eq(updateSchedule.enabled, true),
        lte(updateSchedule.nextRunAt, now()),
      ),
    )
    .orderBy(asc(updateSchedule.nextRunAt))
    .limit(20)
    .all();

  const results: Array<{ scheduleId: string; runId: string | null }> = [];

  for (const schedule of due) {
    try {
      const run = runUpdateRuleNow(schedule.id, "schedule");
      results.push({ scheduleId: schedule.id, runId: run?.id ?? null });
    } catch (error) {
      logError("background.schedule.run_failed", error, { scheduleId: schedule.id });
      const fallbackNext = computeNextRunAt(schedule.intervalMinutes, schedule.jitterSeconds);
      getDb().update(updateSchedule)
        .set({
          nextRunAt: fallbackNext,
          updatedAt: now(),
        })
        .where(eq(updateSchedule.id, schedule.id))
        .run();
    }
  }

  if (due.length > 0) {
    logWarn("background.schedule.processed", {
      due: due.length,
      triggered: results.length,
    });
  }

  return results;
}
