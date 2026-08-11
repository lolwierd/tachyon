import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { backgroundTask } from "@/lib/db/schema";
import {
  cancelRunsByKindScope,
  claimNextTask,
  createRunWithTasks,
  getRun,
  listTasksForRun,
  markTaskCanceled,
  markTaskFailure,
  markTaskSucceeded,
  recomputeRunStatus,
  releaseExpiredLeases,
  requestCancelRun,
} from "@/lib/background/queue";

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

describe("background queue", () => {
  beforeEach(() => {
    cancelRunsByKindScope({ kind: "download", all: true });
    cancelRunsByKindScope({ kind: "update", all: true });
  });

  it("dedupes tasks by dedupe key across active tasks", () => {
    const sourceSeriesId = id("series-dedupe");
    const dedupe = id("dedupe");

    const first = createRunWithTasks({
      kind: "download",
      trigger: "manual",
      tasks: [
        {
          queue: "download",
          taskType: "download_chapter",
          sourceSeriesId,
          sourceChapterId: "ch-1",
          dedupeKey: dedupe,
          priority: 10,
        },
      ],
    });

    const second = createRunWithTasks({
      kind: "download",
      trigger: "manual",
      tasks: [
        {
          queue: "download",
          taskType: "download_chapter",
          sourceSeriesId,
          sourceChapterId: "ch-2",
          dedupeKey: dedupe,
          priority: 10,
        },
        {
          queue: "download",
          taskType: "download_chapter",
          sourceSeriesId,
          sourceChapterId: "ch-3",
          dedupeKey: `${dedupe}-other`,
          priority: 10,
        },
      ],
    });

    expect(first?.totalTasks).toBe(1);
    expect(second?.totalTasks).toBe(1);

    const secondTasks = listTasksForRun(second!.id);
    expect(secondTasks).toHaveLength(1);
    expect(secondTasks[0]?.sourceChapterId).toBe("ch-3");
  });

  it("dedupes repeated dedupe keys within the same enqueue request", () => {
    const sourceSeriesId = id("series-batch-dedupe");
    const dedupe = id("dedupe");

    const run = createRunWithTasks({
      kind: "download",
      trigger: "manual",
      tasks: [
        {
          queue: "download",
          taskType: "download_chapter",
          sourceSeriesId,
          sourceChapterId: "ch-1",
          dedupeKey: dedupe,
        },
        {
          queue: "download",
          taskType: "download_chapter",
          sourceSeriesId,
          sourceChapterId: "ch-2",
          dedupeKey: dedupe,
        },
        {
          queue: "download",
          taskType: "download_chapter",
          sourceSeriesId,
          sourceChapterId: "ch-3",
          dedupeKey: `${dedupe}-other`,
        },
      ],
    });

    expect(run?.totalTasks).toBe(2);
    expect(listTasksForRun(run!.id).map((task) => task.sourceChapterId).sort()).toEqual(["ch-1", "ch-3"]);
  });

  it("claims highest-priority task and flips run to running", () => {
    const sourceSeriesId = id("series-claim");

    const run = createRunWithTasks({
      kind: "update",
      trigger: "manual",
      tasks: [
        {
          queue: "update",
          taskType: "refresh_series",
          sourceSeriesId,
          priority: 100_000,
        },
        {
          queue: "update",
          taskType: "refresh_series",
          sourceSeriesId,
          priority: 99_000,
        },
      ],
    });

    const claimed = claimNextTask("update", id("worker"), 30_000);

    expect(claimed).not.toBeNull();
    expect(claimed?.runId).toBe(run?.id);
    expect(claimed?.priority).toBe(100_000);
    expect(claimed?.attempt).toBe(1);

    const updatedRun = getRun(run!.id);
    expect(updatedRun?.status).toBe("running");
  });

  it("releases expired task leases back to queued", () => {
    const sourceSeriesId = id("series-expired-lease");
    const run = createRunWithTasks({
      kind: "update",
      trigger: "manual",
      tasks: [
        {
          queue: "update",
          taskType: "refresh_series",
          sourceSeriesId,
          priority: 110_000,
        },
      ],
    });

    const claimed = claimNextTask("update", id("worker"), -1);
    expect(claimed).not.toBeNull();

    releaseExpiredLeases("update");

    const [task] = listTasksForRun(run!.id);
    expect(task?.state).toBe("queued");
    expect(task?.leaseOwner).toBeNull();
  });

  it("moves failures to retry_wait when attempts remain", () => {
    const sourceSeriesId = id("series-retry");
    const run = createRunWithTasks({
      kind: "update",
      trigger: "manual",
      tasks: [
        {
          queue: "update",
          taskType: "refresh_series",
          sourceSeriesId,
          maxAttempts: 3,
          priority: 120_000,
        },
      ],
    });

    const claimed = claimNextTask("update", id("worker"), 30_000);
    const result = markTaskFailure(claimed!.id, claimed!.attempt, claimed!.maxAttempts, "temporary");

    expect(result).toBe("retry_wait");

    const [task] = listTasksForRun(run!.id);
    expect(task?.state).toBe("retry_wait");
    expect(task?.lastError).toBe("temporary");
    expect(task?.nextAttemptAt).not.toBeNull();
  });

  it("marks failures as failed when max attempts reached", () => {
    const sourceSeriesId = id("series-fail");
    const run = createRunWithTasks({
      kind: "update",
      trigger: "manual",
      tasks: [
        {
          queue: "update",
          taskType: "refresh_series",
          sourceSeriesId,
          maxAttempts: 1,
          priority: 130_000,
        },
      ],
    });

    const claimed = claimNextTask("update", id("worker"), 30_000);
    const result = markTaskFailure(claimed!.id, claimed!.attempt, claimed!.maxAttempts, "fatal");

    expect(result).toBe("failed");

    const [task] = listTasksForRun(run!.id);
    expect(task?.state).toBe("failed");
    expect(task?.lastError).toBe("fatal");
    expect(task?.finishedAt).not.toBeNull();
  });

  it("recomputes run status to succeeded when all tasks complete", () => {
    const sourceSeriesId = id("series-success");
    const run = createRunWithTasks({
      kind: "update",
      trigger: "manual",
      tasks: [
        {
          queue: "update",
          taskType: "refresh_series",
          sourceSeriesId,
          priority: 140_000,
        },
        {
          queue: "update",
          taskType: "refresh_series",
          sourceSeriesId,
          priority: 139_000,
        },
      ],
    });

    const first = claimNextTask("update", id("worker"), 30_000);
    markTaskSucceeded(first!.id);

    const second = claimNextTask("update", id("worker"), 30_000);
    markTaskSucceeded(second!.id);

    const recomputed = recomputeRunStatus(run!.id);
    expect(recomputed?.status).toBe("succeeded");
    expect(recomputed?.doneTasks).toBe(2);
    expect(recomputed?.failedTasks).toBe(0);
    expect(recomputed?.canceledTasks).toBe(0);
  });

  it("clears stale run errors when a run recovers", () => {
    const sourceSeriesId = id("series-recovery");
    const run = createRunWithTasks({
      kind: "update",
      trigger: "manual",
      tasks: [
        {
          queue: "update",
          taskType: "refresh_series",
          sourceSeriesId,
          maxAttempts: 2,
        },
      ],
    });

    const claimed = claimNextTask("update", id("worker"), 30_000);
    markTaskFailure(claimed!.id, claimed!.attempt, claimed!.maxAttempts, "temporary");
    recomputeRunStatus(run!.id);

    getDb().update(backgroundTask)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(backgroundTask.id, claimed!.id))
      .run();

    const retried = claimNextTask("update", id("worker"), 30_000);
    markTaskSucceeded(retried!.id);

    const recovered = recomputeRunStatus(run!.id);
    expect(recovered?.status).toBe("succeeded");
    expect(recovered?.lastError).toBeNull();
  });

  it("cancels queued tasks when cancel is requested", () => {
    const sourceSeriesId = id("series-cancel-run");
    const run = createRunWithTasks({
      kind: "download",
      trigger: "manual",
      tasks: [
        {
          queue: "download",
          taskType: "download_chapter",
          sourceSeriesId,
          sourceChapterId: "ch-1",
          priority: 200_000,
        },
        {
          queue: "download",
          taskType: "download_chapter",
          sourceSeriesId,
          sourceChapterId: "ch-2",
          priority: 199_000,
        },
      ],
    });

    const canceled = requestCancelRun(run!.id);
    expect(canceled?.status).toBe("canceled");

    const states = listTasksForRun(run!.id).map((task) => task.state);
    expect(states).toEqual(["canceled", "canceled"]);
  });

  it("cancels only runs matching kind+series scope", () => {
    const targetSeries = id("series-target");
    const otherSeries = id("series-other");

    const targetRun = createRunWithTasks({
      kind: "download",
      trigger: "manual",
      tasks: [
        {
          queue: "download",
          taskType: "download_chapter",
          sourceSeriesId: targetSeries,
          sourceChapterId: "ch-1",
          priority: 210_000,
        },
      ],
    });

    const otherRun = createRunWithTasks({
      kind: "download",
      trigger: "manual",
      tasks: [
        {
          queue: "download",
          taskType: "download_chapter",
          sourceSeriesId: otherSeries,
          sourceChapterId: "ch-1",
          priority: 209_000,
        },
      ],
    });

    const result = cancelRunsByKindScope({ kind: "download", sourceSeriesId: targetSeries });
    expect(result.requested).toBeGreaterThanOrEqual(1);

    expect(getRun(targetRun!.id)?.status).toBe("canceled");
    expect(getRun(otherRun!.id)?.status).not.toBe("canceled");

    markTaskCanceled(listTasksForRun(otherRun!.id)[0]!.id, "cleanup");
    recomputeRunStatus(otherRun!.id);
  });

  it("keeps cancellation scoped when providers reuse a series id", () => {
    const sharedSeriesId = id("shared-series");
    const mgekoRun = createRunWithTasks({
      kind: "download",
      trigger: "manual",
      tasks: [{
        queue: "download",
        taskType: "download_chapter",
        sourceSeriesId: sharedSeriesId,
        sourceChapterId: "chapter-1",
        payload: { source: "mgeko" },
      }],
    });
    const weebcentralRun = createRunWithTasks({
      kind: "download",
      trigger: "manual",
      tasks: [{
        queue: "download",
        taskType: "download_chapter",
        sourceSeriesId: sharedSeriesId,
        sourceChapterId: "chapter-1",
        payload: { source: "weebcentral" },
      }],
    });

    const result = cancelRunsByKindScope({
      kind: "download",
      sourceSeriesId: sharedSeriesId,
      sourceName: "mgeko",
    });

    expect(result.requested).toBe(1);
    expect(getRun(mgekoRun!.id)?.status).toBe("canceled");
    expect(getRun(weebcentralRun!.id)?.status).toBe("queued");
    cancelRunsByKindScope({ kind: "download", all: true });
  });
});
