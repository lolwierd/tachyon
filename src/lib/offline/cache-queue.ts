"use client";

/**
 * In-tab queue for caching chapters onto this device. Lives entirely in the
 * foreground tab — iOS PWAs don't get Background Sync, so the user has to
 * keep the app open while large caches warm up. That constraint is fine for
 * the MVP because the user is typically "caching while commuting to wifi".
 *
 * Structure mirrors the server-side `backgroundRun`/`backgroundTask` tables
 * so the /cache page can reuse the look and feel of /downloads:
 *
 *   CacheRun  → one "batch" the user kicked off (e.g. "cache next 10 unread")
 *   CacheTask → a single chapter within a run
 *
 * The store is a plain module-scoped object so multiple components can
 * subscribe to it via `useCacheQueue()`. Runs and tasks are lost when the
 * tab closes; any chapters that finished are still persisted in IndexedDB.
 */

import { useSyncExternalStore } from "react";
import { cacheChapterToDevice, removeChapterFromDevice, requestPersistentStorage } from "./device-cache";

export type CacheRunStatus = "queued" | "running" | "succeeded" | "failed" | "canceling" | "canceled";
export type CacheTaskState = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type CacheTaskKind = "cache" | "delete";

export interface CacheTask {
    id: string;
    kind: CacheTaskKind;
    seriesId: string;
    sourceName: string | null;
    chapterId: string;
    chapterNo: number;
    chapterTitle: string;
    seriesTitle: string | null;
    seriesCoverUrl: string | null;
    state: CacheTaskState;
    loadedPages: number;
    totalPages: number;
    bytes: number;
    error: string | null;
    startedAt: number | null;
    finishedAt: number | null;
}

export interface CacheRun {
    id: string;
    trigger: string;
    scope: {
        sourceSeriesId?: string;
        reason?: string;
    } | null;
    status: CacheRunStatus;
    createdAt: number;
    updatedAt: number;
    tasks: CacheTask[];
}

interface CacheQueueState {
    runs: CacheRun[];
}

const MAX_RUN_HISTORY = 40;
const GLOBAL_CONCURRENCY = 1; // one run at a time; tasks inside a run also run with low concurrency

let state: CacheQueueState = { runs: [] };
const subscribers = new Set<() => void>();
const abortControllers = new Map<string, AbortController>();
let processing = false;

function notify() {
    for (const callback of subscribers) callback();
}

function genId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function trimHistory() {
    if (state.runs.length <= MAX_RUN_HISTORY) return;
    const active = state.runs.filter(
        (run) => run.status === "queued" || run.status === "running" || run.status === "canceling",
    );
    const terminal = state.runs
        .filter((run) => !active.includes(run))
        .sort((left, right) => right.updatedAt - left.updatedAt);
    state = { runs: [...active, ...terminal.slice(0, MAX_RUN_HISTORY - active.length)] };
}

function updateRun(runId: string, patch: (run: CacheRun) => CacheRun) {
    state = { runs: state.runs.map((run) => (run.id === runId ? { ...patch(run), updatedAt: Date.now() } : run)) };
    notify();
}

function updateTask(runId: string, taskId: string, patch: (task: CacheTask) => CacheTask) {
    state = {
        runs: state.runs.map((run) => {
            if (run.id !== runId) return run;
            const nextTasks = run.tasks.map((task) => (task.id === taskId ? patch(task) : task));
            return { ...run, tasks: nextTasks, updatedAt: Date.now() };
        }),
    };
    notify();
}

function computeRunStatus(tasks: CacheTask[], currentStatus: CacheRunStatus): CacheRunStatus {
    const allTerminal = tasks.every(
        (task) => task.state === "succeeded" || task.state === "failed" || task.state === "canceled",
    );
    if (!allTerminal) {
        return currentStatus === "canceling" ? "canceling" : currentStatus === "queued" ? "queued" : "running";
    }
    if (tasks.every((task) => task.state === "canceled")) return "canceled";
    if (tasks.some((task) => task.state === "failed")) return "failed";
    if (tasks.some((task) => task.state === "canceled")) return "canceled";
    return "succeeded";
}

async function processQueue() {
    if (processing) return;
    processing = true;
    try {
        await requestPersistentStorage();
        while (true) {
            const nextRun = state.runs.find((run) => run.status === "queued");
            if (!nextRun) break;
            await runCacheRun(nextRun.id);
        }
    } finally {
        processing = false;
        // Re-check in case a run was enqueued while we were in the
        // finally transition (between the while-loop break and here).
        if (state.runs.some((run) => run.status === "queued")) {
            void processQueue();
        }
    }
}

async function runCacheRun(runId: string) {
    updateRun(runId, (run) => ({ ...run, status: "running" }));

    let cancelRequested = false;
    const currentRun = state.runs.find((run) => run.id === runId);
    if (!currentRun) return;

    for (const task of currentRun.tasks) {
        const liveRun = state.runs.find((run) => run.id === runId);
        if (!liveRun) return;
        if (liveRun.status === "canceling") {
            cancelRequested = true;
        }

        const liveTask = liveRun.tasks.find((candidate) => candidate.id === task.id);
        if (!liveTask || liveTask.state !== "queued") continue;

        if (cancelRequested) {
            updateTask(runId, task.id, (existing) => ({
                ...existing,
                state: "canceled",
                finishedAt: Date.now(),
            }));
            continue;
        }

        const controller = new AbortController();
        abortControllers.set(task.id, controller);

        updateTask(runId, task.id, (existing) => ({
            ...existing,
            state: "running",
            startedAt: Date.now(),
        }));

        if (task.kind === "delete") {
            try {
                if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
                await removeChapterFromDevice(task.seriesId, task.chapterId);
                updateTask(runId, task.id, (existing) => ({
                    ...existing,
                    state: "succeeded",
                    finishedAt: Date.now(),
                }));
            } catch (error) {
                const isAbort = error instanceof DOMException && error.name === "AbortError";
                updateTask(runId, task.id, (existing) => ({
                    ...existing,
                    state: isAbort ? "canceled" : "failed",
                    error: isAbort ? "Canceled" : error instanceof Error ? error.message : "Unknown error",
                    finishedAt: Date.now(),
                }));
            } finally {
                abortControllers.delete(task.id);
            }
            continue;
        }

        try {
            const result = await cacheChapterToDevice(
                {
                    seriesId: task.seriesId,
                    chapterId: task.chapterId,
                    sourceName: task.sourceName,
                    chapterNo: task.chapterNo,
                    title: task.chapterTitle,
                    seriesTitle: task.seriesTitle,
                    seriesCoverUrl: task.seriesCoverUrl,
                },
                {
                    signal: controller.signal,
                    concurrency: 2,
                    onProgress: (progress) => {
                        updateTask(runId, task.id, (existing) => ({
                            ...existing,
                            loadedPages: progress.loadedPages,
                            totalPages: progress.totalPages,
                            bytes: progress.bytesSoFar,
                        }));
                    },
                },
            );

            updateTask(runId, task.id, (existing) => ({
                ...existing,
                state:
                    result.entry.state === "ready"
                        ? "succeeded"
                        : result.entry.state === "partial"
                            ? "failed"
                            : "failed",
                loadedPages: result.fetchedPages,
                totalPages: result.entry.pageCount,
                bytes: result.bytes,
                error: result.failedPages > 0 ? `${result.failedPages} page(s) failed` : null,
                finishedAt: Date.now(),
            }));
        } catch (error) {
            const isAbort = error instanceof DOMException && error.name === "AbortError";
            updateTask(runId, task.id, (existing) => ({
                ...existing,
                state: isAbort ? "canceled" : "failed",
                error: isAbort ? "Canceled" : error instanceof Error ? error.message : "Unknown error",
                finishedAt: Date.now(),
            }));
        } finally {
            abortControllers.delete(task.id);
        }
    }

    // Recompute final status — computeRunStatus now correctly
    // transitions "canceling" to a terminal state when all tasks are done.
    updateRun(runId, (run) => ({
        ...run,
        status: computeRunStatus(run.tasks, run.status),
    }));
    trimHistory();
    notify();
}

export interface EnqueueCacheTaskInput {
    seriesId: string;
    sourceName: string | null;
    chapterId: string;
    chapterNo: number;
    chapterTitle: string;
    seriesTitle?: string | null;
    seriesCoverUrl?: string | null;
    /** Per-task kind override. Falls back to the run-level `kind` param. */
    kind?: CacheTaskKind;
}

export function enqueueCacheRun(params: {
    trigger: string;
    scope?: CacheRun["scope"];
    tasks: EnqueueCacheTaskInput[];
    kind?: CacheTaskKind;
}): CacheRun | null {
    if (params.tasks.length === 0) return null;
    const now = Date.now();
    const kind = params.kind ?? "cache";
    const run: CacheRun = {
        id: genId(),
        trigger: params.trigger,
        scope: params.scope ?? null,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        tasks: params.tasks.map((input) => ({
            id: genId(),
            kind: input.kind ?? kind,
            seriesId: input.seriesId,
            sourceName: input.sourceName,
            chapterId: input.chapterId,
            chapterNo: input.chapterNo,
            chapterTitle: input.chapterTitle,
            seriesTitle: input.seriesTitle ?? null,
            seriesCoverUrl: input.seriesCoverUrl ?? null,
            state: "queued",
            loadedPages: 0,
            totalPages: 0,
            bytes: 0,
            error: null,
            startedAt: null,
            finishedAt: null,
        })),
    };
    state = { runs: [run, ...state.runs] };
    notify();
    void processQueue();
    return run;
}

export function cancelRun(runId: string) {
    const run = state.runs.find((candidate) => candidate.id === runId);
    if (!run) return;
    if (run.status === "succeeded" || run.status === "failed" || run.status === "canceled") return;
    updateRun(runId, (existing) => ({ ...existing, status: "canceling" }));
    // Re-read the live run after the status update so we see the latest
    // task states (avoids a race where a task transitions from "queued"
    // to "running" between the snapshot and the loop).
    const liveRun = state.runs.find((candidate) => candidate.id === runId);
    if (!liveRun) return;
    for (const task of liveRun.tasks) {
        // Abort all registered controllers unconditionally — a task
        // may have just transitioned to "running" and registered its
        // controller after the snapshot was taken.
        const controller = abortControllers.get(task.id);
        if (controller) controller.abort();
        if (task.state === "queued") {
            updateTask(runId, task.id, (existing) => ({
                ...existing,
                state: "canceled",
                finishedAt: Date.now(),
            }));
        }
    }
}

export function cancelAllRuns() {
    for (const run of state.runs) {
        if (run.status === "queued" || run.status === "running" || run.status === "canceling") {
            cancelRun(run.id);
        }
    }
}

export function retryRun(runId: string) {
    const run = state.runs.find((candidate) => candidate.id === runId);
    if (!run) return null;
    const failedTasks = run.tasks.filter((task) => task.state === "failed" || task.state === "canceled");
    if (failedTasks.length === 0) return null;
    return enqueueCacheRun({
        trigger: `${run.trigger}:retry`,
        scope: run.scope,
        tasks: failedTasks.map((task) => ({
            seriesId: task.seriesId,
            sourceName: task.sourceName,
            chapterId: task.chapterId,
            chapterNo: task.chapterNo,
            chapterTitle: task.chapterTitle,
            seriesTitle: task.seriesTitle,
            seriesCoverUrl: task.seriesCoverUrl,
            kind: task.kind,
        })),
    });
}

function subscribe(callback: () => void) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
}

function getSnapshot(): CacheQueueState {
    return state;
}

const EMPTY_STATE: CacheQueueState = { runs: [] };
function getServerSnapshot(): CacheQueueState {
    return EMPTY_STATE;
}

export function useCacheQueue(): CacheQueueState {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useActiveCacheCount(): number {
    const queue = useCacheQueue();
    return queue.runs.filter(
        (run) => run.status === "queued" || run.status === "running" || run.status === "canceling",
    ).length;
}

export function __resetCacheQueueForTests(): void {
    state = { runs: [] };
    abortControllers.clear();
    processing = false;
    notify();
}

// Ensure GLOBAL_CONCURRENCY is used as the queue processor's worker count.
// Right now we only run one run at a time to keep the UX simple; kept as a
// constant so it's easy to find later.
void GLOBAL_CONCURRENCY;
