import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const claimNextTaskMock = vi.fn();
const markTaskCanceledMock = vi.fn();
const markTaskFailureMock = vi.fn();
const markTaskSucceededMock = vi.fn();
const recomputeRunStatusMock = vi.fn();
const releaseExpiredLeasesMock = vi.fn();
const setRunErrorMock = vi.fn();
const touchWorkerHeartbeatMock = vi.fn();

const executeTaskMock = vi.fn();
const isRetryableTaskErrorMock = vi.fn();

const getBackgroundSettingsMock = vi.fn();
const isDownloadFallbackActiveMock = vi.fn();
const setDownloadFallbackWindowMock = vi.fn();

const processDueUpdateSchedulesMock = vi.fn();

const logErrorMock = vi.fn();
const logInfoMock = vi.fn();
const logWarnMock = vi.fn();

const purgeOldRunsMock = vi.fn().mockReturnValue(0);

vi.mock("@/lib/background/queue", () => ({
  claimNextTask: claimNextTaskMock,
  markTaskCanceled: markTaskCanceledMock,
  markTaskFailure: markTaskFailureMock,
  markTaskSucceeded: markTaskSucceededMock,
  purgeOldRuns: purgeOldRunsMock,
  recomputeRunStatus: recomputeRunStatusMock,
  releaseExpiredLeases: releaseExpiredLeasesMock,
  setRunError: setRunErrorMock,
  touchWorkerHeartbeat: touchWorkerHeartbeatMock,
}));

vi.mock("@/lib/background/executors", () => ({
  executeTask: executeTaskMock,
  isRetryableTaskError: isRetryableTaskErrorMock,
}));

vi.mock("@/lib/background/settings", () => ({
  getBackgroundSettings: getBackgroundSettingsMock,
  isDownloadFallbackActive: isDownloadFallbackActiveMock,
  setDownloadFallbackWindow: setDownloadFallbackWindowMock,
}));

vi.mock("@/lib/background/schedules", () => ({
  processDueUpdateSchedules: processDueUpdateSchedulesMock,
}));

vi.mock("@/lib/server/log", () => ({
  logError: logErrorMock,
  logInfo: logInfoMock,
  logWarn: logWarnMock,
}));

interface MockTask {
  id: string;
  runId: string;
  queue: "download" | "update";
  taskType: "download_chapter" | "delete_read_downloads" | "refresh_series";
  sourceSeriesId: string | null;
  sourceChapterId: string | null;
  payload: unknown;
  priority: number;
  attempt: number;
  maxAttempts: number;
  runStatus: "queued" | "running" | "succeeded" | "failed" | "canceling" | "canceled";
  cancelRequested: boolean;
}

function makeTask(overrides: Partial<MockTask> = {}): MockTask {
  return {
    id: `task-${crypto.randomUUID()}`,
    runId: `run-${crypto.randomUUID()}`,
    queue: "download",
    taskType: "download_chapter",
    sourceSeriesId: "series-1",
    sourceChapterId: "chapter-1",
    payload: {},
    priority: 10,
    attempt: 1,
    maxAttempts: 3,
    runStatus: "queued",
    cancelRequested: false,
    ...overrides,
  };
}

let workerModule: typeof import("./worker") | null = null;

async function importWorker() {
  workerModule = await import("./worker");
  return workerModule;
}

async function stopWorkerIfRunning() {
  if (!workerModule) {
    return;
  }

  const stopPromise = workerModule.stopBackgroundWorker();
  await vi.advanceTimersByTimeAsync(1000);
  await stopPromise;
}

describe("background worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-05T00:00:00.000Z"));

    claimNextTaskMock.mockReset();
    markTaskCanceledMock.mockReset();
    markTaskFailureMock.mockReset();
    markTaskSucceededMock.mockReset();
    recomputeRunStatusMock.mockReset();
    releaseExpiredLeasesMock.mockReset();
    setRunErrorMock.mockReset();
    touchWorkerHeartbeatMock.mockReset();

    executeTaskMock.mockReset();
    isRetryableTaskErrorMock.mockReset();

    getBackgroundSettingsMock.mockReset();
    isDownloadFallbackActiveMock.mockReset();
    setDownloadFallbackWindowMock.mockReset();

    processDueUpdateSchedulesMock.mockReset();

    logErrorMock.mockReset();
    logInfoMock.mockReset();
    logWarnMock.mockReset();

    getBackgroundSettingsMock.mockReturnValue({
      downloadConcurrency: 1,
      downloadConcurrencyFallback: 1,
      failureThreshold: 4,
      fallbackCooldownMinutes: 30,
    });
    isDownloadFallbackActiveMock.mockReturnValue(false);
    claimNextTaskMock.mockReturnValue(null);
    executeTaskMock.mockResolvedValue(undefined);
    isRetryableTaskErrorMock.mockReturnValue(false);
    markTaskFailureMock.mockReturnValue("failed");

    process.env.BACKGROUND_WORKER_ID = "test-worker";

    vi.resetModules();
    workerModule = null;
  });

  afterEach(async () => {
    await stopWorkerIfRunning();
    workerModule = null;
    delete process.env.BACKGROUND_WORKER_ID;
    vi.useRealTimers();
  });

  it("processes successful tasks and recomputes status", async () => {
    const task = makeTask();
    const byQueue: Record<string, MockTask[]> = {
      download: [task],
      update: [],
    };

    claimNextTaskMock.mockImplementation((queue: "download" | "update") => byQueue[queue].shift() ?? null);

    const worker = await importWorker();
    worker.startBackgroundWorker();

    await Promise.resolve();

    expect(executeTaskMock).toHaveBeenCalledWith(task, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(markTaskSucceededMock).toHaveBeenCalledWith(task.id, "test-worker");
    expect(recomputeRunStatusMock).toHaveBeenCalledWith(task.runId);
    expect(releaseExpiredLeasesMock).toHaveBeenCalledWith("download");
    expect(releaseExpiredLeasesMock).toHaveBeenCalledWith("update");
  });

  it("cancels tasks before execution when cancellation is requested", async () => {
    const task = makeTask({ cancelRequested: true });
    const byQueue: Record<string, MockTask[]> = { download: [task], update: [] };
    claimNextTaskMock.mockImplementation((queue: "download" | "update") => byQueue[queue].shift() ?? null);

    const worker = await importWorker();
    worker.startBackgroundWorker();

    await Promise.resolve();

    expect(executeTaskMock).not.toHaveBeenCalled();
    expect(markTaskCanceledMock).toHaveBeenCalledWith(task.id, "Canceled before execution", "test-worker");
    expect(recomputeRunStatusMock).toHaveBeenCalledWith(task.runId);
  });

  it("uses retry semantics for retryable download failures", async () => {
    const task = makeTask({ queue: "download", attempt: 1, maxAttempts: 5 });
    const byQueue: Record<string, MockTask[]> = { download: [task], update: [] };
    claimNextTaskMock.mockImplementation((queue: "download" | "update") => byQueue[queue].shift() ?? null);

    executeTaskMock.mockRejectedValue(new Error("timeout talking to upstream"));
    isRetryableTaskErrorMock.mockReturnValue(true);
    markTaskFailureMock.mockReturnValue("retry_wait");

    const worker = await importWorker();
    worker.startBackgroundWorker();

    await Promise.resolve();
    await Promise.resolve();

    expect(markTaskFailureMock).toHaveBeenCalledWith(task.id, 1, 5, "timeout talking to upstream", "test-worker");
    expect(setRunErrorMock).toHaveBeenCalledWith(task.runId, "timeout talking to upstream");
    expect(recomputeRunStatusMock).toHaveBeenCalledWith(task.runId);
    expect(setDownloadFallbackWindowMock).not.toHaveBeenCalled();
  });

  it("triggers fallback window when retryable download failures cross threshold", async () => {
    const taskA = makeTask({ id: "task-a", runId: "run-a", attempt: 1, maxAttempts: 3 });
    const taskB = makeTask({ id: "task-b", runId: "run-b", attempt: 1, maxAttempts: 3 });

    getBackgroundSettingsMock.mockReturnValue({
      downloadConcurrency: 2,
      downloadConcurrencyFallback: 1,
      failureThreshold: 2,
      fallbackCooldownMinutes: 15,
    });

    const byQueue: Record<string, MockTask[]> = {
      download: [taskA, taskB],
      update: [],
    };
    claimNextTaskMock.mockImplementation((queue: "download" | "update") => byQueue[queue].shift() ?? null);

    executeTaskMock.mockRejectedValue(new Error("network timeout"));
    isRetryableTaskErrorMock.mockReturnValue(true);
    markTaskFailureMock.mockReturnValue("retry_wait");

    const worker = await importWorker();
    worker.startBackgroundWorker();

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(markTaskFailureMock).toHaveBeenCalledTimes(2);
    expect(setDownloadFallbackWindowMock).toHaveBeenCalledTimes(1);
    expect(setDownloadFallbackWindowMock.mock.calls[0]?.[0]).toBeInstanceOf(Date);
    expect(logWarnMock).toHaveBeenCalledWith(
      "background.worker.download_fallback_enabled",
      expect.objectContaining({ fallbackConcurrency: 1 }),
    );
  });

  it("treats non-retryable errors as terminal", async () => {
    const task = makeTask({ attempt: 2, maxAttempts: 4 });
    const byQueue: Record<string, MockTask[]> = { download: [task], update: [] };
    claimNextTaskMock.mockImplementation((queue: "download" | "update") => byQueue[queue].shift() ?? null);

    executeTaskMock.mockRejectedValue(new Error("schema mismatch"));
    isRetryableTaskErrorMock.mockReturnValue(false);
    markTaskFailureMock.mockReturnValue("failed");

    const worker = await importWorker();
    worker.startBackgroundWorker();

    await Promise.resolve();
    await Promise.resolve();

    expect(markTaskFailureMock).toHaveBeenCalledWith(task.id, 4, 4, "schema mismatch", "test-worker");
    expect(setRunErrorMock).toHaveBeenCalledWith(task.runId, "schema mismatch");
    expect(logErrorMock).toHaveBeenCalledWith(
      "background.worker.task_failed",
      expect.any(Error),
      expect.objectContaining({ taskId: task.id, runId: task.runId }),
    );
  });

  it("ticks heartbeat and schedules on intervals", async () => {
    const worker = await importWorker();
    worker.startBackgroundWorker();

    expect(touchWorkerHeartbeatMock).toHaveBeenCalledTimes(1);
    expect(processDueUpdateSchedulesMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_100);
    expect(touchWorkerHeartbeatMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    await vi.advanceTimersByTimeAsync(5_200);
    expect(processDueUpdateSchedulesMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("uses fallback concurrency cap when fallback is active", async () => {
    getBackgroundSettingsMock.mockReturnValue({
      downloadConcurrency: 4,
      downloadConcurrencyFallback: 2,
      failureThreshold: 10,
      fallbackCooldownMinutes: 30,
    });
    isDownloadFallbackActiveMock.mockReturnValue(true);

    const tasks = [
      makeTask({ id: "task-1" }),
      makeTask({ id: "task-2" }),
      makeTask({ id: "task-3" }),
    ];

    claimNextTaskMock.mockImplementation((queue: "download" | "update") => {
      if (queue === "download") {
        return tasks.shift() ?? null;
      }
      return null;
    });

    const worker = await importWorker();
    worker.startBackgroundWorker();

    await Promise.resolve();

    expect(executeTaskMock).toHaveBeenCalledTimes(2);

    const state = worker.getWorkerRuntimeState();
    expect(state.started).toBe(true);
    expect(state.workerId).toBe("test-worker");
    expect(state.fallbackActive).toBe(true);
  });

  it("is idempotent on repeated start and can stop cleanly", async () => {
    const worker = await importWorker();

    worker.startBackgroundWorker();
    worker.startBackgroundWorker();

    expect(logInfoMock).toHaveBeenCalledWith("background.worker.started", { workerId: "test-worker" });

    const stopping = worker.stopBackgroundWorker();
    await vi.advanceTimersByTimeAsync(300);
    await stopping;

    expect(worker.getWorkerRuntimeState().started).toBe(false);
    expect(logInfoMock).toHaveBeenCalledWith("background.worker.stopped", { workerId: "test-worker" });
  });
});
