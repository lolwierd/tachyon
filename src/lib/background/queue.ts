import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { backgroundRun, backgroundTask, workerHeartbeat } from "@/lib/db/schema";

export type RunKind = "download" | "update" | "maintenance";
export type RunTrigger = "manual" | "schedule" | "automation";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceling" | "canceled";
export type TaskQueue = "download" | "update" | "maintenance";
export type TaskState = "queued" | "running" | "retry_wait" | "succeeded" | "failed" | "canceled";
export type TaskType = "download_chapter" | "delete_read_downloads" | "refresh_series" | "optimize_cache";

export interface TaskInsertInput {
  queue: TaskQueue;
  taskType: TaskType;
  sourceSeriesId?: string;
  sourceChapterId?: string;
  payload?: unknown;
  priority?: number;
  maxAttempts?: number;
  dedupeKey?: string;
}

export interface ClaimedTask {
  id: string;
  runId: string;
  queue: TaskQueue;
  taskType: TaskType;
  sourceSeriesId: string | null;
  sourceChapterId: string | null;
  payload: unknown;
  priority: number;
  attempt: number;
  maxAttempts: number;
  runStatus: RunStatus;
  cancelRequested: boolean;
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

export function touchWorkerHeartbeat(workerId: string, version = "dev") {
  getDb().insert(workerHeartbeat).values({
    workerId,
    version,
    lastSeenAt: now(),
  }).onConflictDoUpdate({
    target: workerHeartbeat.workerId,
    set: {
      version,
      lastSeenAt: now(),
    },
  }).run();
}

export function getLatestWorkerHeartbeat() {
  return getDb().select()
    .from(workerHeartbeat)
    .orderBy(desc(workerHeartbeat.lastSeenAt))
    .get() ?? null;
}

export function createRunWithTasks(input: {
  kind: RunKind;
  trigger: RunTrigger;
  scope?: unknown;
  tasks: TaskInsertInput[];
}) {
  const timestamp = now();
  const runId = crypto.randomUUID();
  const dedupeKeys = input.tasks
    .map((task) => task.dedupeKey)
    .filter((value): value is string => Boolean(value));

  getDb().transaction((tx) => {
    const blocked = dedupeKeys.length > 0
      ? new Set(
        tx.select({ dedupeKey: backgroundTask.dedupeKey })
          .from(backgroundTask)
          .where(
            and(
              inArray(backgroundTask.state, ["queued", "retry_wait", "running"]),
              inArray(backgroundTask.dedupeKey, dedupeKeys),
            ),
          )
          .all()
          .map((row) => row.dedupeKey)
          .filter((value): value is string => Boolean(value)),
      )
      : new Set<string>();

    const seenDedupeKeys = new Set(blocked);
    const filteredTasks = input.tasks.filter((task) => {
      if (!task.dedupeKey) {
        return true;
      }
      if (seenDedupeKeys.has(task.dedupeKey)) {
        return false;
      }
      seenDedupeKeys.add(task.dedupeKey);
      return true;
    });

    tx.insert(backgroundRun).values({
      id: runId,
      kind: input.kind,
      trigger: input.trigger,
      status: filteredTasks.length > 0 ? "queued" : "succeeded",
      scopeJson: input.scope ? JSON.stringify(input.scope) : null,
      totalTasks: filteredTasks.length,
      doneTasks: 0,
      failedTasks: 0,
      canceledTasks: 0,
      finishedAt: filteredTasks.length === 0 ? timestamp : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run();

    if (filteredTasks.length > 0) {
      const BATCH_SIZE = 50;
      const taskRows = filteredTasks.map((task) => ({
        id: crypto.randomUUID(),
        runId,
        queue: task.queue,
        taskType: task.taskType,
        sourceSeriesId: task.sourceSeriesId ?? null,
        sourceChapterId: task.sourceChapterId ?? null,
        payloadJson: task.payload != null ? JSON.stringify(task.payload) : null,
        priority: task.priority ?? 0,
        state: "queued" as const,
        attempt: 0,
        maxAttempts: task.maxAttempts ?? 3,
        nextAttemptAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        startedAt: null,
        finishedAt: null,
        lastError: null,
        dedupeKey: task.dedupeKey ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      }));

      for (let i = 0; i < taskRows.length; i += BATCH_SIZE) {
        tx.insert(backgroundTask)
          .values(taskRows.slice(i, i + BATCH_SIZE))
          .onConflictDoNothing()
          .run();
      }

      const insertedTotal = Number(
        tx.select({ value: sql<number>`count(*)` })
          .from(backgroundTask)
          .where(eq(backgroundTask.runId, runId))
          .get()?.value ?? 0,
      );

      if (insertedTotal !== filteredTasks.length) {
        tx.update(backgroundRun)
          .set({
            status: insertedTotal > 0 ? "queued" : "succeeded",
            totalTasks: insertedTotal,
            finishedAt: insertedTotal > 0 ? null : timestamp,
            updatedAt: timestamp,
          })
          .where(eq(backgroundRun.id, runId))
          .run();
      }
    }
  });

  return getRun(runId);
}

export function getRun(runId: string) {
  const row = getDb().select().from(backgroundRun).where(eq(backgroundRun.id, runId)).get();
  if (!row) return null;
  return {
    ...row,
    scope: parseJson(row.scopeJson),
  };
}

export function listRuns(kind: RunKind, options?: { limit?: number; status?: RunStatus; sourceSeriesId?: string }) {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);

  const runRows = options?.sourceSeriesId
    ? getDb().selectDistinct({
      id: backgroundRun.id,
      kind: backgroundRun.kind,
      trigger: backgroundRun.trigger,
      status: backgroundRun.status,
      scopeJson: backgroundRun.scopeJson,
      totalTasks: backgroundRun.totalTasks,
      doneTasks: backgroundRun.doneTasks,
      failedTasks: backgroundRun.failedTasks,
      canceledTasks: backgroundRun.canceledTasks,
      startedAt: backgroundRun.startedAt,
      finishedAt: backgroundRun.finishedAt,
      cancelRequestedAt: backgroundRun.cancelRequestedAt,
      lastError: backgroundRun.lastError,
      createdAt: backgroundRun.createdAt,
      updatedAt: backgroundRun.updatedAt,
    })
      .from(backgroundRun)
      .innerJoin(backgroundTask, eq(backgroundTask.runId, backgroundRun.id))
      .where(
        and(
          eq(backgroundRun.kind, kind),
          options?.status ? eq(backgroundRun.status, options.status) : undefined,
          eq(backgroundTask.sourceSeriesId, options.sourceSeriesId),
        ),
      )
      .orderBy(desc(backgroundRun.createdAt))
      .limit(limit)
      .all()
    : getDb().select()
      .from(backgroundRun)
      .where(
        and(
          eq(backgroundRun.kind, kind),
          options?.status ? eq(backgroundRun.status, options.status) : undefined,
        ),
      )
      .orderBy(desc(backgroundRun.createdAt))
      .limit(limit)
      .all();

  return runRows.map((row) => ({ ...row, scope: parseJson(row.scopeJson) }));
}

export function listTasksForRun(runId: string, options?: { limit?: number; offset?: number }) {
  const limit = Math.min(Math.max(options?.limit ?? 500, 1), 500);
  const offset = Math.max(options?.offset ?? 0, 0);

  return getDb().select()
    .from(backgroundTask)
    .where(eq(backgroundTask.runId, runId))
    .orderBy(desc(backgroundTask.priority), asc(backgroundTask.createdAt))
    .limit(limit)
    .offset(offset)
    .all()
    .map((row) => ({
      ...row,
      payload: parseJson(row.payloadJson),
    }));
}

export function listTasksForRuns(runIds: string[], options?: { limitPerRun?: number }) {
  if (runIds.length === 0) return new Map<string, ReturnType<typeof listTasksForRun>>();

  const limitPerRun = Math.min(Math.max(options?.limitPerRun ?? 500, 1), 500);

  const rows = getDb().select()
    .from(backgroundTask)
    .where(inArray(backgroundTask.runId, runIds))
    .orderBy(desc(backgroundTask.priority), asc(backgroundTask.createdAt))
    .all();

  const grouped = new Map<string, ReturnType<typeof listTasksForRun>>();
  for (const row of rows) {
    let list = grouped.get(row.runId);
    if (!list) {
      list = [];
      grouped.set(row.runId, list);
    }
    if (list.length < limitPerRun) {
      list.push({ ...row, payload: parseJson(row.payloadJson) });
    }
  }

  return grouped;
}

export function releaseExpiredLeases(queue: TaskQueue) {
  const timestamp = now();

  // Tasks that have exhausted retries → mark as failed
  getDb().update(backgroundTask)
    .set({
      state: "failed",
      finishedAt: timestamp,
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: timestamp,
      lastError: "Lease expired after max attempts",
    })
    .where(
      and(
        eq(backgroundTask.queue, queue),
        eq(backgroundTask.state, "running"),
        lte(backgroundTask.leaseExpiresAt, timestamp),
        sql`${backgroundTask.attempt} >= ${backgroundTask.maxAttempts}`,
      ),
    )
    .run();

  // Tasks with remaining retries → re-queue
  getDb().update(backgroundTask)
    .set({
      state: "queued",
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(backgroundTask.queue, queue),
        eq(backgroundTask.state, "running"),
        lte(backgroundTask.leaseExpiresAt, timestamp),
      ),
    )
    .run();
}

export function claimNextTask(queue: TaskQueue, workerId: string, leaseMs: number): ClaimedTask | null {
  const timestamp = now();

  const candidate = getDb().select({
    id: backgroundTask.id,
    runId: backgroundTask.runId,
  })
    .from(backgroundTask)
    .innerJoin(backgroundRun, eq(backgroundRun.id, backgroundTask.runId))
    .where(
      and(
        eq(backgroundTask.queue, queue),
        inArray(backgroundTask.state, ["queued", "retry_wait"]),
        or(isNull(backgroundTask.nextAttemptAt), lte(backgroundTask.nextAttemptAt, timestamp)),
        inArray(backgroundRun.status, ["queued", "running", "canceling"]),
      ),
    )
    .orderBy(desc(backgroundTask.priority), asc(backgroundTask.createdAt))
    .get();

  if (!candidate) {
    return null;
  }

  const nextAttempt = timestamp;
  const leaseExpires = new Date(timestamp.getTime() + leaseMs);

  const updated = getDb().update(backgroundTask)
    .set({
      state: "running",
      leaseOwner: workerId,
      leaseExpiresAt: leaseExpires,
      startedAt: timestamp,
      attempt: sql`${backgroundTask.attempt} + 1`,
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(backgroundTask.id, candidate.id),
        inArray(backgroundTask.state, ["queued", "retry_wait"]),
        or(isNull(backgroundTask.nextAttemptAt), lte(backgroundTask.nextAttemptAt, nextAttempt)),
      ),
    )
    .run();

  if (updated.changes === 0) {
    return null;
  }

  const row = getDb().select({
    id: backgroundTask.id,
    runId: backgroundTask.runId,
    queue: backgroundTask.queue,
    taskType: backgroundTask.taskType,
    sourceSeriesId: backgroundTask.sourceSeriesId,
    sourceChapterId: backgroundTask.sourceChapterId,
    payloadJson: backgroundTask.payloadJson,
    priority: backgroundTask.priority,
    attempt: backgroundTask.attempt,
    maxAttempts: backgroundTask.maxAttempts,
    runStatus: backgroundRun.status,
    cancelRequestedAt: backgroundRun.cancelRequestedAt,
  })
    .from(backgroundTask)
    .innerJoin(backgroundRun, eq(backgroundTask.runId, backgroundRun.id))
    .where(eq(backgroundTask.id, candidate.id))
    .get();

  if (!row) {
    return null;
  }

  if (row.runStatus === "queued") {
    getDb().update(backgroundRun)
      .set({
        status: "running",
        startedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(eq(backgroundRun.id, row.runId))
      .run();
  }

  return {
    id: row.id,
    runId: row.runId,
    queue: row.queue,
    taskType: row.taskType,
    sourceSeriesId: row.sourceSeriesId,
    sourceChapterId: row.sourceChapterId,
    payload: parseJson(row.payloadJson),
    priority: row.priority,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    runStatus: row.runStatus,
    cancelRequested: row.cancelRequestedAt != null,
  };
}

function retryDelayMs(attempt: number) {
  const base = 1000;
  const max = 5 * 60 * 1000;
  const factor = Math.min(2 ** Math.max(attempt - 1, 0), 300);
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(base * factor + jitter, max);
}

export function markTaskSucceeded(taskId: string, ownerId?: string) {
  getDb().update(backgroundTask)
    .set({
      state: "succeeded",
      finishedAt: now(),
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now(),
      lastError: null,
    })
    .where(
      ownerId
        ? and(eq(backgroundTask.id, taskId), eq(backgroundTask.leaseOwner, ownerId))
        : eq(backgroundTask.id, taskId),
    )
    .run();
}

export function markTaskCanceled(taskId: string, reason?: string, ownerId?: string) {
  getDb().update(backgroundTask)
    .set({
      state: "canceled",
      finishedAt: now(),
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now(),
      lastError: reason ?? null,
    })
    .where(
      ownerId
        ? and(eq(backgroundTask.id, taskId), eq(backgroundTask.leaseOwner, ownerId))
        : eq(backgroundTask.id, taskId),
    )
    .run();
}

export function markTaskFailure(taskId: string, attempt: number, maxAttempts: number, errorMessage: string, ownerId?: string) {
  const ownerGuard = ownerId
    ? and(eq(backgroundTask.id, taskId), eq(backgroundTask.leaseOwner, ownerId))
    : eq(backgroundTask.id, taskId);

  if (attempt < maxAttempts) {
    const nextAttemptAt = new Date(Date.now() + retryDelayMs(attempt));
    getDb().update(backgroundTask)
      .set({
        state: "retry_wait",
        nextAttemptAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now(),
        lastError: errorMessage,
      })
      .where(ownerGuard)
      .run();
    return "retry_wait" as const;
  }

  getDb().update(backgroundTask)
    .set({
      state: "failed",
      finishedAt: now(),
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now(),
      lastError: errorMessage,
    })
    .where(ownerGuard)
    .run();

  return "failed" as const;
}

function getRunTaskCounts(runId: string) {
  const row = getDb().select({
    total: sql<number>`count(*)`,
    done: sql<number>`sum(case when ${backgroundTask.state} = 'succeeded' then 1 else 0 end)`,
    failed: sql<number>`sum(case when ${backgroundTask.state} = 'failed' then 1 else 0 end)`,
    canceled: sql<number>`sum(case when ${backgroundTask.state} = 'canceled' then 1 else 0 end)`,
    active: sql<number>`sum(case when ${backgroundTask.state} in ('queued', 'retry_wait', 'running') then 1 else 0 end)`,
  })
    .from(backgroundTask)
    .where(eq(backgroundTask.runId, runId))
    .get();

  return {
    total: Number(row?.total ?? 0),
    done: Number(row?.done ?? 0),
    failed: Number(row?.failed ?? 0),
    canceled: Number(row?.canceled ?? 0),
    active: Number(row?.active ?? 0),
  };
}

export function recomputeRunStatus(runId: string) {
  const run = getDb().select().from(backgroundRun).where(eq(backgroundRun.id, runId)).get();
  if (!run) return null;

  const counts = getRunTaskCounts(runId);
  const timestamp = now();

  const nextStatus: RunStatus = counts.active > 0
    ? (run.cancelRequestedAt ? "canceling" : "running")
    : counts.failed > 0
      ? "failed"
      : counts.canceled > 0
        ? "canceled"
        : "succeeded";

  getDb().update(backgroundRun)
    .set({
      status: nextStatus,
      totalTasks: counts.total,
      doneTasks: counts.done,
      failedTasks: counts.failed,
      canceledTasks: counts.canceled,
      startedAt: run.startedAt ?? timestamp,
      finishedAt: counts.active > 0 ? null : timestamp,
      updatedAt: timestamp,
      lastError: nextStatus === "failed" ? run.lastError : null,
    })
    .where(eq(backgroundRun.id, runId))
    .run();

  return getRun(runId);
}

export function requestCancelRun(runId: string) {
  const timestamp = now();
  getDb().update(backgroundRun)
    .set({
      status: "canceling",
      cancelRequestedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(backgroundRun.id, runId))
    .run();

  getDb().update(backgroundTask)
    .set({
      state: "canceled",
      finishedAt: timestamp,
      updatedAt: timestamp,
      lastError: "Canceled by user",
    })
    .where(
      and(
        eq(backgroundTask.runId, runId),
        inArray(backgroundTask.state, ["queued", "retry_wait"]),
      ),
    )
    .run();

  return recomputeRunStatus(runId);
}

export function isRunCancellationRequested(runId: string) {
  const run = getDb().select({ cancelRequestedAt: backgroundRun.cancelRequestedAt })
    .from(backgroundRun)
    .where(eq(backgroundRun.id, runId))
    .get();

  return Boolean(run?.cancelRequestedAt);
}

function activeRunStatuses() {
  return ["queued", "running", "canceling"] as RunStatus[];
}

export function listCancelRequestedRunIds() {
  return getDb().select({ id: backgroundRun.id })
    .from(backgroundRun)
    .where(
      and(
        inArray(backgroundRun.status, activeRunStatuses()),
        isNotNull(backgroundRun.cancelRequestedAt),
      ),
    )
    .all()
    .map((row) => row.id);
}

export function cancelRunsByKindScope(input: {
  kind: RunKind;
  all?: boolean;
  sourceSeriesId?: string;
  count?: number;
}) {
  let runIds: string[] = [];

  if (input.all) {
    runIds = getDb().select({ id: backgroundRun.id })
      .from(backgroundRun)
      .where(and(eq(backgroundRun.kind, input.kind), inArray(backgroundRun.status, activeRunStatuses())))
      .all()
      .map((row) => row.id);
  } else if (input.sourceSeriesId) {
    runIds = getDb().selectDistinct({ id: backgroundRun.id })
      .from(backgroundRun)
      .innerJoin(backgroundTask, eq(backgroundTask.runId, backgroundRun.id))
      .where(
        and(
          eq(backgroundRun.kind, input.kind),
          inArray(backgroundRun.status, activeRunStatuses()),
          eq(backgroundTask.sourceSeriesId, input.sourceSeriesId),
          inArray(backgroundTask.state, ["queued", "retry_wait", "running"]),
        ),
      )
      .all()
      .map((row) => row.id);
  } else if (input.count && input.count > 0) {
    runIds = getDb().select({ id: backgroundRun.id })
      .from(backgroundRun)
      .where(and(eq(backgroundRun.kind, input.kind), inArray(backgroundRun.status, activeRunStatuses())))
      .orderBy(desc(backgroundRun.createdAt))
      .limit(input.count)
      .all()
      .map((row) => row.id);
  }

  const results = runIds.map((runId) => requestCancelRun(runId));
  return {
    requested: runIds.length,
    runs: results,
  };
}

export function getRunTaskStateCounts(runId: string) {
  const counts = getRunTaskCounts(runId);
  return counts;
}

export function listActiveRuns(kind: RunKind) {
  return getDb().select()
    .from(backgroundRun)
    .where(and(eq(backgroundRun.kind, kind), inArray(backgroundRun.status, activeRunStatuses())))
    .all();
}

export function updateRunScope(runId: string, scope: unknown) {
  getDb().update(backgroundRun)
    .set({
      scopeJson: JSON.stringify(scope),
      updatedAt: now(),
    })
    .where(eq(backgroundRun.id, runId))
    .run();
}

export function setRunError(runId: string, message: string) {
  getDb().update(backgroundRun)
    .set({
      lastError: message,
      updatedAt: now(),
    })
    .where(eq(backgroundRun.id, runId))
    .run();
}

const RETENTION_DAYS = 7;
const WORKER_HEARTBEAT_RETENTION_MS = 2 * 60 * 60 * 1000;

export function purgeOldRuns() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const terminalStatuses: RunStatus[] = ["succeeded", "failed", "canceled"];

  const oldRunIds = getDb().select({ id: backgroundRun.id })
    .from(backgroundRun)
    .where(
      and(
        inArray(backgroundRun.status, terminalStatuses),
        lte(backgroundRun.finishedAt, cutoff),
      ),
    )
    .all()
    .map((row) => row.id);

  if (oldRunIds.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < oldRunIds.length; i += batchSize) {
      const batch = oldRunIds.slice(i, i + batchSize);
      getDb().delete(backgroundTask).where(inArray(backgroundTask.runId, batch)).run();
      getDb().delete(backgroundRun).where(inArray(backgroundRun.id, batch)).run();
    }
  }

  const heartbeatCutoff = new Date(Date.now() - WORKER_HEARTBEAT_RETENTION_MS);
  getDb().delete(workerHeartbeat)
    .where(lte(workerHeartbeat.lastSeenAt, heartbeatCutoff))
    .run();

  return oldRunIds.length;
}
