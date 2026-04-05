import {
  claimNextTask,
  isRunCancellationRequested,
  listCancelRequestedRunIds,
  markTaskCanceled,
  markTaskFailure,
  markTaskSucceeded,
  purgeOldRuns,
  recomputeRunStatus,
  releaseExpiredLeases,
  setRunError,
  touchWorkerHeartbeat,
  type ClaimedTask,
} from "@/lib/background/queue";
import { executeTask, isRetryableTaskError } from "@/lib/background/executors";
import {
  getBackgroundSettings,
  isDownloadFallbackActive,
  setDownloadFallbackWindow,
} from "@/lib/background/settings";
import { processDueUpdateSchedules } from "@/lib/background/schedules";
import { logError, logInfo, logWarn } from "@/lib/server/log";

const LOOP_INTERVAL_MS = 250;
const LEASE_MS = 10 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const SCHEDULE_INTERVAL_MS = 10_000;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;

const runningCounts: Record<string, number> = {
  download: 0,
  update: 0,
  maintenance: 0,
};

let started = false;
let stopping = false;
let loopPromise: Promise<void> | null = null;
let workerId = `worker-${crypto.randomUUID()}`;
let retryableFailureTimes: number[] = [];
const activeTasks = new Set<Promise<void>>();
const activeAbortControllers = new Set<AbortController>();
const activeAbortControllersByRunId = new Map<string, Set<AbortController>>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimFailureWindow(nowTs: number) {
  retryableFailureTimes = retryableFailureTimes.filter((ts) => nowTs - ts <= FAILURE_WINDOW_MS);
}

function maybeTriggerDownloadFallback() {
  const settings = getBackgroundSettings();
  const nowTs = Date.now();
  trimFailureWindow(nowTs);

  if (retryableFailureTimes.length < settings.failureThreshold) {
    return;
  }

  const fallbackUntil = new Date(nowTs + settings.fallbackCooldownMinutes * 60 * 1000);
  setDownloadFallbackWindow(fallbackUntil);
  retryableFailureTimes = [];

  logWarn("background.worker.download_fallback_enabled", {
    fallbackUntil: fallbackUntil.toISOString(),
    fallbackConcurrency: settings.downloadConcurrencyFallback,
  });
}

function getTargetConcurrency() {
  const settings = getBackgroundSettings();
  const activeFallback = isDownloadFallbackActive();
  const concurrency = activeFallback
    ? settings.downloadConcurrencyFallback
    : settings.downloadConcurrency;

  // Equal-share pools: both queues run at the same pool size.
  return Math.min(Math.max(concurrency, 1), 16);
}

function registerAbortController(runId: string, controller: AbortController) {
  const controllers = activeAbortControllersByRunId.get(runId) ?? new Set<AbortController>();
  controllers.add(controller);
  activeAbortControllersByRunId.set(runId, controllers);
}

function unregisterAbortController(runId: string, controller: AbortController) {
  const controllers = activeAbortControllersByRunId.get(runId);
  if (!controllers) {
    return;
  }

  controllers.delete(controller);
  if (controllers.size === 0) {
    activeAbortControllersByRunId.delete(runId);
  }
}

function abortCanceledRuns() {
  for (const runId of listCancelRequestedRunIds()) {
    const controllers = activeAbortControllersByRunId.get(runId);
    if (!controllers) {
      continue;
    }

    for (const controller of controllers) {
      controller.abort(new Error("Run canceled"));
    }
  }
}

async function handleClaimedTask(task: ClaimedTask) {
  const ac = new AbortController();
  activeAbortControllers.add(ac);
  registerAbortController(task.runId, ac);
  const taskLeaseMs = task.queue === "maintenance" ? 60 * 60 * 1000 : LEASE_MS; // 1 hour for maintenance
  const leaseTimer = setTimeout(() => ac.abort(new Error("Lease expired")), taskLeaseMs);

  try {
    if (task.cancelRequested) {
      markTaskCanceled(task.id, "Canceled before execution", workerId);
      recomputeRunStatus(task.runId);
      return;
    }

    await executeTask(task, { signal: ac.signal });
    markTaskSucceeded(task.id, workerId);
    recomputeRunStatus(task.runId);
  } catch (error) {
    if (task.cancelRequested || isRunCancellationRequested(task.runId)) {
      markTaskCanceled(task.id, "Canceled during execution", workerId);
      recomputeRunStatus(task.runId);
      return;
    }

    const message = error instanceof Error ? error.message : "Unknown worker error";
    const retryable = isRetryableTaskError(error);

    if (retryable && task.queue === "download") {
      retryableFailureTimes.push(Date.now());
      maybeTriggerDownloadFallback();
    }

    const finalState = retryable
      ? markTaskFailure(task.id, task.attempt, task.maxAttempts, message, workerId)
      : markTaskFailure(task.id, task.maxAttempts, task.maxAttempts, message, workerId);

    setRunError(task.runId, message);
    recomputeRunStatus(task.runId);

    if (finalState === "failed") {
      logError("background.worker.task_failed", error, {
        taskId: task.id,
        runId: task.runId,
        queue: task.queue,
        taskType: task.taskType,
      });
    }
  } finally {
    clearTimeout(leaseTimer);
    activeAbortControllers.delete(ac);
    unregisterAbortController(task.runId, ac);
    runningCounts[task.queue] = Math.max(runningCounts[task.queue] - 1, 0);
  }
}

function pumpQueue(queue: "download" | "update" | "maintenance") {
  releaseExpiredLeases(queue);

  const target = getTargetConcurrency();
  const queueLeaseMs = queue === "maintenance" ? 60 * 60 * 1000 : LEASE_MS;
  while (runningCounts[queue] < target) {
    const task = claimNextTask(queue, workerId, queueLeaseMs);
    if (!task) {
      break;
    }

    runningCounts[queue] += 1;
    const taskPromise = handleClaimedTask(task).finally(() => {
      activeTasks.delete(taskPromise);
    });
    activeTasks.add(taskPromise);
  }
}

async function loop() {
  logInfo("background.worker.started", { workerId });

  let lastHeartbeat = 0;
  let lastScheduleTick = 0;
  let lastPurge = 0;

  while (!stopping) {
    const nowTs = Date.now();

    if (nowTs - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      touchWorkerHeartbeat(workerId, process.env.npm_package_version ?? "dev");
      lastHeartbeat = nowTs;
    }

    if (nowTs - lastScheduleTick >= SCHEDULE_INTERVAL_MS) {
      try {
        processDueUpdateSchedules();
      } catch (error) {
        logError("background.worker.schedule_tick_failed", error);
      }
      lastScheduleTick = nowTs;
    }

    if (nowTs - lastPurge >= PURGE_INTERVAL_MS) {
      try {
        const purged = purgeOldRuns();
        if (purged > 0) {
          logInfo("background.worker.purged_old_runs", { purged });
        }
      } catch (error) {
        logError("background.worker.purge_failed", error);
      }
      lastPurge = nowTs;
    }

    try {
      abortCanceledRuns();
      pumpQueue("download");
      pumpQueue("update");
      pumpQueue("maintenance");
    } catch (error) {
      logError("background.worker.pump_failed", error);
    }

    await sleep(LOOP_INTERVAL_MS);
  }

  logInfo("background.worker.stopped", { workerId });
}

export function startBackgroundWorker() {
  if (started) {
    return;
  }

  started = true;
  stopping = false;
  workerId = process.env.BACKGROUND_WORKER_ID || workerId;
  loopPromise = loop();
}

export async function stopBackgroundWorker() {
  if (!started) {
    return;
  }

  stopping = true;
  await loopPromise;

  if (activeTasks.size > 0) {
    logInfo("background.worker.draining", { inflight: activeTasks.size });
    for (const ac of activeAbortControllers) {
      ac.abort(new Error("Worker shutting down"));
    }
    await Promise.allSettled([...activeTasks]);
  }

  loopPromise = null;
  started = false;
}

export function getWorkerRuntimeState() {
  return {
    started,
    workerId,
    runningDownload: runningCounts.download,
    runningUpdate: runningCounts.update,
    fallbackActive: isDownloadFallbackActive(),
  };
}
