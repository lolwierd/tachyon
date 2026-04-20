"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  AlertTriangle,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { useNsfw } from "@/lib/nsfw-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  RunCard,
  RunHistory,
  type RunCardData,
  type RunCardTask,
  type RunStatus,
  type TaskState,
} from "@/components/run-card";

interface TaskRecord {
  id: string;
  taskType: string;
  sourceSeriesId: string | null;
  sourceChapterId: string | null;
  state: string;
  attempt: number;
  maxAttempts: number;
  lastError: string | null;
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

const STATUS_LABEL: Record<RunStatus, string> = {
  queued: "queued",
  running: "running",
  canceling: "canceling",
  succeeded: "done",
  failed: "failed",
  canceled: "canceled",
};

function timeAgoString(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function runKindOf(run: RunRecord): string {
  const reason = run.scope?.reason ?? "";
  if (
    reason.includes("deleteRead") ||
    run.tasks.some((task) => task.taskType === "delete_read_downloads")
  ) {
    return "Delete";
  }
  if (reason.startsWith("bulk:")) return "Bulk download";
  if (
    reason === "single" ||
    reason === "manual:chapters" ||
    run.tasks.some((task) => task.taskType === "download_chapter")
  ) {
    return "Download";
  }
  if (
    reason === "optimize_cache" ||
    run.tasks.some((task) => task.taskType === "optimize_cache")
  ) {
    return "Optimize cache";
  }
  return "Run";
}

function normalizeTaskState(raw: string): TaskState {
  switch (raw) {
    case "succeeded":
    case "failed":
    case "running":
    case "queued":
    case "pending":
    case "canceled":
      return raw;
    default:
      return "queued";
  }
}

function toRunCardData(run: RunRecord): RunCardData {
  const seriesId =
    run.seriesLinkId ??
    run.tasks.find((t) => t.seriesLinkId)?.seriesLinkId ??
    run.scope?.sourceSeriesId ??
    run.tasks.find((t) => t.sourceSeriesId)?.sourceSeriesId ??
    null;
  const displayTitle =
    run.seriesTitle ??
    run.tasks.find((t) => t.seriesTitle)?.seriesTitle ??
    null;

  const tasks: RunCardTask[] = run.tasks.map((t) => {
    const chapterLabel =
      t.chapterNo != null
        ? `Ch. ${t.chapterNo % 1 === 0 ? t.chapterNo.toFixed(0) : t.chapterNo}`
        : t.sourceChapterId ?? t.id.slice(0, 8);
    return {
      id: t.id,
      chapterLabel,
      chapterTitle: t.chapterTitle,
      state: normalizeTaskState(t.state),
      attempt: t.attempt,
      error: t.lastError,
    };
  });

  return {
    id: run.id,
    title: displayTitle ?? seriesId ?? null,
    titleHref: seriesId ? `/series/${seriesId}` : null,
    status: run.status,
    statusLabel: STATUS_LABEL[run.status],
    totalTasks: run.totalTasks,
    doneTasks: run.doneTasks,
    failedTasks: run.failedTasks,
    updatedAtTime: (run.updatedAt ?? run.createdAt)
      ? new Date((run.updatedAt ?? run.createdAt) as string).getTime()
      : null,
    kind: runKindOf(run),
    kindDetail: run.scope?.reason ?? null,
    tasks,
  };
}

function seriesIdFromRun(run: RunRecord): string | undefined {
  return (
    run.scope?.sourceSeriesId ??
    run.tasks.find((t) => t.sourceSeriesId)?.sourceSeriesId ??
    undefined
  );
}

export default function DownloadsPage() {
  const { nsfwEnabled } = useNsfw();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [settings, setSettings] = useState<BackgroundSettings | null>(null);
  const [workerHeartbeat, setWorkerHeartbeat] = useState<WorkerHeartbeat | null>(null);

  async function load() {
    const [runsRes, settingsRes] = await Promise.all([
      fetch("/api/downloads/runs?includeTasks=true&limit=50", { cache: "no-store" }),
      fetch("/api/background/settings", { cache: "no-store" }),
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
    const id = window.setInterval(() => {
      load().catch(() => {});
    }, 5_000);
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

  async function refresh() {
    setBusy("refresh");
    try {
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl leading-none text-text">Downloads</h1>
          <p className="mt-1 font-display italic text-sm text-text-faint">
            The queue — what&rsquo;s being fetched from the archives right now.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activeRuns.length > 0 && (
            <Button
              variant="danger"
              onClick={() => void cancelAll()}
              disabled={busy !== null}
              leading={<XCircle className="h-3.5 w-3.5" />}
            >
              Cancel all
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => void refresh()}
            disabled={busy === "refresh"}
            leading={<RefreshCw className={cn("h-3.5 w-3.5", busy === "refresh" && "animate-spin")} />}
          >
            {busy === "refresh" ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Worker status bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm border border-border-subtle bg-surface px-3 py-2 text-xs sm:gap-x-6">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              workerAlive ? "bg-completed animate-pulse" : "bg-text-faint",
            )}
          />
          <span className="text-text-muted">{workerAlive ? "Worker active" : "Worker idle"}</span>
          {workerHeartbeat && (
            <span className="font-mono text-text-faint">{timeAgoString(workerHeartbeat.lastSeenAt)}</span>
          )}
        </div>
        {settings && (
          <span className="text-text-faint">
            Concurrency{" "}
            <span className="font-mono text-text-muted">{settings.downloadConcurrency}</span>
            {fallbackActive && (
              <span className="ml-1 text-paused">
                → {settings.downloadConcurrencyFallback} (fallback)
              </span>
            )}
          </span>
        )}
        {activeRuns.length > 0 && (
          <span className="text-text-faint">
            <span className="font-mono font-medium text-reading">{activeRuns.length}</span> active
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
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">Active</p>
          {activeRuns.length > 0 && (
            <span className="rounded-full bg-reading/15 px-2 py-0.5 font-mono text-[10px] font-medium text-reading">
              {activeRuns.length}
            </span>
          )}
        </div>

        {activeRuns.length === 0 ? (
          <p className="rounded-sm border border-border-subtle bg-surface px-3 py-3 font-display italic text-sm text-text-faint">
            The queue is quiet.
          </p>
        ) : (
          activeRuns.map((run) => {
            const seriesId = seriesIdFromRun(run);
            return (
              <RunCard
                key={run.id}
                data={toRunCardData(run)}
                actions={{
                  onCancelRun: () => void cancelRun(run.id),
                  onCancelSeries: seriesId ? () => void cancelSeries(seriesId) : undefined,
                  cancelRunBusy: busy === `cancel-run-${run.id}` || busy === "cancel-all",
                  cancelSeriesBusy:
                    busy === `cancel-series-${seriesId ?? ""}` || busy === "cancel-all",
                }}
              />
            );
          })
        )}
      </section>

      {/* History */}
      <RunHistory
        items={historyRuns}
        renderItem={(run) => (
          <RunCard
            key={run.id}
            data={toRunCardData(run)}
            actions={{
              onRetry: run.status === "failed" ? () => void retryRun(run.id) : undefined,
              retryBusy: busy === `retry-${run.id}`,
            }}
          />
        )}
      />
    </div>
  );
}
