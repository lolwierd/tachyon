"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Activity,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from "lucide-react";
import { ProgressLine } from "@/components/ui/progress-line";
import { useNsfw } from "@/lib/nsfw-context";
import { cn } from "@/lib/utils";

type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceling" | "canceled";

interface TaskRecord {
  id: string;
  taskType: string;
  sourceSeriesId: string | null;
  sourceChapterId: string | null;
  state: string;
  attempt: number;
  maxAttempts: number;
  lastError: string | null;
  // enriched by API
  seriesTitle: string | null;
  seriesLinkId: string | null;
  seriesAdult: boolean | null;
  chapterNo: number | null;
  chapterTitle: string | null;
}

interface RunRecord {
  id: string;
  status: RunStatus;
  trigger: string;
  totalTasks: number;
  doneTasks: number;
  failedTasks: number;
  canceledTasks: number;
  createdAt: string | null;
  updatedAt: string | null;
  scope: { sourceSeriesId?: string; reason?: string } | null;
  tasks: TaskRecord[];
  // enriched by API
  seriesTitle: string | null;
  seriesLinkId: string | null;
  seriesAdult: boolean | null;
}

interface BackgroundSettings {
  downloadConcurrency: number;
  downloadConcurrencyFallback: number;
  fallbackUntil: string | null;
}

interface WorkerHeartbeat {
  workerId: string;
  lastSeenAt: string;
  version: string;
}

const STATUS_CFG: Record<RunStatus, { label: string; dotClass: string; labelClass: string }> = {
  queued: { label: "Queued", dotClass: "bg-text-faint", labelClass: "text-text-faint" },
  running: { label: "Running", dotClass: "bg-reading animate-pulse", labelClass: "text-reading" },
  canceling: { label: "Canceling", dotClass: "bg-paused animate-pulse", labelClass: "text-paused" },
  succeeded: { label: "Done", dotClass: "bg-completed", labelClass: "text-completed" },
  failed: { label: "Failed", dotClass: "bg-dropped", labelClass: "text-dropped" },
  canceled: { label: "Canceled", dotClass: "bg-text-faint", labelClass: "text-text-faint" },
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatRunKind(run: RunRecord) {
  const reason = run.scope?.reason ?? "";
  if (reason.includes("deleteRead") || run.tasks.some((task) => task.taskType === "delete_read_downloads")) {
    return "Delete";
  }
  if (reason.startsWith("bulk:")) {
    return "Bulk download";
  }
  if (
    reason === "single" ||
    reason === "manual:chapters" ||
    run.tasks.some((task) => task.taskType === "download_chapter")
  ) {
    return "Download";
  }
  return "Run";
}

function RunCard({
  run,
  onCancelRun,
  onCancelSeries,
  cancelRunBusy,
  cancelSeriesBusy,
  onRetry,
  retryBusy,
}: {
  run: RunRecord;
  onCancelRun?: () => void;
  onCancelSeries?: () => void;
  cancelRunBusy: boolean;
  cancelSeriesBusy: boolean;
  onRetry?: () => void;
  retryBusy?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CFG[run.status];
  const seriesId =
    run.seriesLinkId ??
    run.tasks.find((t) => t.seriesLinkId)?.seriesLinkId ??
    run.scope?.sourceSeriesId ??
    run.tasks.find((t) => t.sourceSeriesId)?.sourceSeriesId;
  const displayTitle =
    run.seriesTitle ??
    run.tasks.find((t) => t.seriesTitle)?.seriesTitle ??
    null;
  const isActive =
    run.status === "queued" ||
    run.status === "running" ||
    run.status === "canceling";
  const progress = run.totalTasks > 0 ? run.doneTasks / run.totalTasks : 0;
  const runKind = formatRunKind(run);
  const runMeta = run.scope?.reason ? `${runKind} · ${run.scope.reason}` : runKind;

  return (
    <article className="overflow-hidden rounded-sm border border-border-subtle bg-surface">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", cfg.dotClass)} />

        <div className="min-w-0 flex-1">
          {seriesId ? (
            <Link
              href={`/series/${seriesId}`}
              className="block truncate text-sm font-medium text-text transition-colors hover:text-accent"
            >
              {displayTitle ?? seriesId}
            </Link>
          ) : (
            <span className="font-mono text-xs text-text-faint">{run.id.slice(0, 8)}</span>
          )}
          <span className="text-[10px] text-text-faint">{runMeta}</span>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="tabular-nums text-xs text-text-muted">
            {run.doneTasks}
            <span className="text-text-faint">/{run.totalTasks}</span>
          </span>
          {run.failedTasks > 0 && (
            <span className="text-xs text-dropped">{run.failedTasks} failed</span>
          )}
          <span className={cn("text-[11px] font-medium", cfg.labelClass)}>{cfg.label}</span>
          <span className="hidden text-[10px] text-text-faint sm:inline">
            {timeAgo(run.updatedAt ?? run.createdAt)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isActive && onCancelRun && (
            <button
              type="button"
              onClick={onCancelRun}
              disabled={cancelRunBusy || run.status === "canceling"}
              className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[11px] text-text-faint transition-colors hover:border-dropped/50 hover:text-dropped disabled:opacity-50"
            >
              <XCircle className="h-3 w-3" />
              Cancel run
            </button>
          )}
          {isActive && onCancelSeries && (
            <button
              type="button"
              onClick={onCancelSeries}
              disabled={cancelSeriesBusy || run.status === "canceling"}
              className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[11px] text-text-faint transition-colors hover:border-dropped/50 hover:text-dropped disabled:opacity-50"
            >
              <XCircle className="h-3 w-3" />
              Cancel series
            </button>
          )}
          {run.status === "failed" && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retryBusy}
              className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[11px] text-text-faint transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              Retry
            </button>
          )}
          {run.tasks.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="rounded-sm p-1 text-text-faint transition-colors hover:text-text-muted"
              aria-label={expanded ? "Collapse tasks" : "Expand tasks"}
            >
              {expanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {isActive && run.totalTasks > 0 && (
        <ProgressLine value={progress} className="rounded-none" />
      )}

      {expanded && run.tasks.length > 0 && (
        <div className="space-y-0.5 border-t border-border-subtle px-3 py-2">
          {run.tasks.slice(0, 30).map((task) => {
            const chapterLabel =
              task.chapterNo != null
                ? `Ch. ${task.chapterNo % 1 === 0 ? task.chapterNo.toFixed(0) : task.chapterNo}`
                : (task.sourceChapterId ?? task.id.slice(0, 8));
            const stateClass =
              task.state === "succeeded"
                ? "bg-completed"
                : task.state === "failed"
                  ? "bg-dropped"
                  : task.state === "running"
                    ? "bg-reading animate-pulse"
                    : "bg-text-faint";
            return (
              <div key={task.id} className="flex items-center gap-2 py-0.5 text-[11px]">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stateClass)} />
                <span className="w-16 shrink-0 font-mono text-text-muted">{chapterLabel}</span>
                {task.chapterTitle && (
                  <span className="min-w-0 flex-1 truncate text-text-faint">{task.chapterTitle}</span>
                )}
                <div className="flex-1" />
                <span className="shrink-0 text-text-faint">{task.state}</span>
                {task.attempt > 1 && (
                  <span className="shrink-0 text-text-faint">×{task.attempt}</span>
                )}
                {task.lastError && (
                  <span className="max-w-[180px] truncate text-dropped">{task.lastError}</span>
                )}
              </div>
            );
          })}
          {run.tasks.length > 30 && (
            <p className="pt-1 text-[10px] text-text-faint">+{run.tasks.length - 30} more</p>
          )}
        </div>
      )}
    </article>
  );
}

export default function DownloadsPage() {
  const { nsfwEnabled } = useNsfw();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [settings, setSettings] = useState<BackgroundSettings | null>(null);
  const [workerHeartbeat, setWorkerHeartbeat] = useState<WorkerHeartbeat | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyPageSize, setHistoryPageSize] = useState(20);

  async function load() {
    const [runsRes, settingsRes] = await Promise.all([
      fetch("/api/downloads/runs?includeTasks=true&limit=50"),
      fetch("/api/background/settings"),
    ]);

    if (runsRes.ok) {
      const body = (await runsRes.json()) as { runs: RunRecord[] };
      setRuns(body.runs ?? []);
    }

    if (settingsRes.ok) {
      const body = (await settingsRes.json()) as {
        settings: BackgroundSettings;
        workerHeartbeat: WorkerHeartbeat | null;
      };
      setSettings(body.settings);
      setWorkerHeartbeat(body.workerHeartbeat);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        await load();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    const id = window.setInterval(() => void load(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const activeRuns = useMemo(
    () =>
      runs.filter(
        (r) =>
          (r.status === "queued" || r.status === "running" || r.status === "canceling") &&
          (nsfwEnabled || r.seriesAdult !== true),
      ),
    [nsfwEnabled, runs],
  );

  const historyRuns = useMemo(
    () =>
      runs.filter(
        (r) =>
          (r.status === "succeeded" || r.status === "failed" || r.status === "canceled") &&
          (nsfwEnabled || r.seriesAdult !== true),
      ),
    [nsfwEnabled, runs],
  );

  const fallbackActive = settings?.fallbackUntil
    ? new Date(settings.fallbackUntil).getTime() > Date.now()
    : false;

  const workerAlive = workerHeartbeat
    ? Date.now() - new Date(workerHeartbeat.lastSeenAt).getTime() < 120_000
    : false;

  async function cancelAll() {
    setBusy("cancel-all");
    try {
      await fetch("/api/downloads/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all" }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function cancelSeries(seriesId: string) {
    setBusy(`cancel-series-${seriesId}`);
    try {
      await fetch("/api/downloads/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "series", seriesId }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function cancelRun(runId: string) {
    setBusy(`cancel-run-${runId}`);
    try {
      await fetch("/api/downloads/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "run", runId }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function retryRun(runId: string) {
    setBusy(`retry-${runId}`);
    try {
      await fetch("/api/downloads/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retryFailed", runId }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl leading-none text-text">Downloads</h1>
          <p className="mt-1 text-xs text-text-faint">Background chapter download queue.</p>
        </div>
        <div className="flex items-center gap-2">
          {activeRuns.length > 0 && (
            <button
              type="button"
              onClick={() => void cancelAll()}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:border-dropped/50 hover:text-dropped disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" />
              Cancel all
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Worker status bar */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-sm border border-border-subtle bg-surface px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              workerAlive ? "bg-completed animate-pulse" : "bg-text-faint",
            )}
          />
          <span className="text-text-muted">{workerAlive ? "Worker active" : "Worker idle"}</span>
          {workerHeartbeat && (
            <span className="text-text-faint">{timeAgo(workerHeartbeat.lastSeenAt)}</span>
          )}
        </div>
        {settings && (
          <span className="text-text-faint">
            Concurrency{" "}
            <span className="text-text-muted">{settings.downloadConcurrency}</span>
            {fallbackActive && (
              <span className="ml-1 text-paused">
                → {settings.downloadConcurrencyFallback} (fallback)
              </span>
            )}
          </span>
        )}
        {activeRuns.length > 0 && (
          <span className="text-text-faint">
            <span className="font-medium text-reading">{activeRuns.length}</span> active
          </span>
        )}
      </div>

      {/* Fallback warning */}
      {fallbackActive && (
        <div className="flex items-start gap-2 rounded-sm border border-paused/40 bg-paused/10 px-3 py-2 text-xs text-paused">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p>
              High error rate detected. Concurrency reduced to{" "}
              {settings?.downloadConcurrencyFallback}.
            </p>
            <p className="font-mono text-[10px] text-text-faint">
              Until{" "}
              {settings?.fallbackUntil
                ? new Date(settings.fallbackUntil).toLocaleString()
                : "—"}
            </p>
          </div>
        </div>
      )}

      {/* Active downloads */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Active</p>
          {activeRuns.length > 0 && (
            <span className="rounded-full bg-reading/15 px-2 py-0.5 font-mono text-[10px] font-medium text-reading">
              {activeRuns.length}
            </span>
          )}
        </div>

        {activeRuns.length === 0 ? (
          <div className="flex items-center gap-2 rounded-sm border border-border-subtle bg-surface px-3 py-3 text-xs text-text-faint">
            <Activity className="h-3.5 w-3.5" />
            No active downloads
          </div>
        ) : (
          activeRuns.map((run) => {
            const seriesId =
              run.scope?.sourceSeriesId ??
              run.tasks.find((t) => t.sourceSeriesId)?.sourceSeriesId;
            return (
              <RunCard
                key={run.id}
                run={run}
                cancelRunBusy={busy === `cancel-run-${run.id}` || busy === "cancel-all"}
                cancelSeriesBusy={busy === `cancel-series-${seriesId}` || busy === "cancel-all"}
                onCancelRun={() => void cancelRun(run.id)}
                onCancelSeries={seriesId ? () => void cancelSeries(seriesId) : undefined}
              />
            );
          })
        )}
      </section>

      {/* History */}
      {historyRuns.length > 0 && (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-2 text-left"
          >
            <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
              History
            </span>
            <span className="font-mono text-[10px] text-text-faint">({historyRuns.length})</span>
            {showHistory ? (
              <ChevronUp className="h-3 w-3 text-text-faint" />
            ) : (
              <ChevronDown className="h-3 w-3 text-text-faint" />
            )}
          </button>

          {showHistory && (
            <>
              {historyRuns.slice(0, historyPageSize).map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  cancelRunBusy={false}
                  cancelSeriesBusy={false}
                  onRetry={run.status === "failed" ? () => void retryRun(run.id) : undefined}
                  retryBusy={busy === `retry-${run.id}`}
                />
              ))}
              {historyRuns.length > historyPageSize && (
                <button
                  type="button"
                  onClick={() => setHistoryPageSize((p) => p + 20)}
                  className="w-full rounded-sm border border-border-subtle py-1.5 text-xs text-text-faint transition-colors hover:border-border hover:text-text-muted"
                >
                  Load {Math.min(20, historyRuns.length - historyPageSize)} more
                </button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
