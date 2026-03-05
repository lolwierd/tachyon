"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle, XCircle, RefreshCw } from "lucide-react";

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
  scope: {
    sourceSeriesId?: string;
    reason?: string;
  } | null;
  tasks: TaskRecord[];
}

interface SettingsPayload {
  settings: {
    fallbackUntil: string | null;
    downloadConcurrency: number;
    downloadConcurrencyFallback: number;
  };
}

export default function DownloadsPage() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [seriesCancelId, setSeriesCancelId] = useState("");
  const [cancelCount, setCancelCount] = useState("3");
  const [settings, setSettings] = useState<SettingsPayload["settings"] | null>(null);

  async function load() {
    const [runsRes, settingsRes] = await Promise.all([
      fetch("/api/downloads/runs?includeTasks=true&limit=50"),
      fetch("/api/background/settings"),
    ]);

    if (runsRes.ok) {
      const body = await runsRes.json() as { runs: RunRecord[] };
      setRuns(body.runs ?? []);
    }

    if (settingsRes.ok) {
      const body = await settingsRes.json() as SettingsPayload;
      setSettings(body.settings);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await load();
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void init();
    const id = window.setInterval(() => {
      void load();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const activeRuns = useMemo(
    () => runs.filter((run) => run.status === "queued" || run.status === "running" || run.status === "canceling"),
    [runs],
  );

  const fallbackActive = useMemo(() => {
    if (!settings?.fallbackUntil) return false;
    return new Date(settings.fallbackUntil).getTime() > Date.now();
  }, [settings?.fallbackUntil]);

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

  async function cancelSeries() {
    if (!seriesCancelId.trim()) return;
    setBusy("cancel-series");
    try {
      await fetch("/api/downloads/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "series", seriesId: seriesCancelId.trim() }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function cancelN() {
    const value = Number.parseInt(cancelCount, 10);
    if (!Number.isFinite(value) || value <= 0) return;
    setBusy("cancel-n");
    try {
      await fetch("/api/downloads/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "count", count: value }),
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl leading-none text-text">Downloads</h1>
          <p className="mt-1 text-xs text-text-faint">Background download queue, progress, and cancellation controls.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {fallbackActive && (
        <div className="flex items-start gap-2 rounded-sm border border-paused/40 bg-paused/10 px-3 py-2 text-xs text-paused">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
          <div>
            <p>High download error rate detected. Concurrency auto-reduced to {settings?.downloadConcurrencyFallback}.</p>
            <p className="font-mono text-[10px] text-text-faint">Fallback until {settings?.fallbackUntil ? new Date(settings.fallbackUntil).toLocaleString() : "-"}</p>
          </div>
        </div>
      )}

      <section className="space-y-2 rounded-sm border border-border-subtle bg-surface p-3">
        <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Queue controls</p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void cancelAll()}
            disabled={busy !== null || activeRuns.length === 0}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            <XCircle className="h-3.5 w-3.5" />
            Cancel all
          </button>

          <input
            value={seriesCancelId}
            onChange={(event) => setSeriesCancelId(event.target.value)}
            placeholder="Series ID"
            className="rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-xs text-text"
          />
          <button
            type="button"
            onClick={() => void cancelSeries()}
            disabled={busy !== null || !seriesCancelId.trim()}
            className="rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            Cancel series
          </button>

          <input
            value={cancelCount}
            onChange={(event) => setCancelCount(event.target.value)}
            className="w-16 rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-xs text-text"
          />
          <button
            type="button"
            onClick={() => void cancelN()}
            disabled={busy !== null}
            className="rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            Cancel N
          </button>
        </div>
      </section>

      <div className="space-y-2">
        {runs.length === 0 ? (
          <p className="text-sm text-text-faint">No download runs yet.</p>
        ) : (
          runs.map((run) => {
            const sourceSeriesId = run.scope?.sourceSeriesId ?? run.tasks.find((task) => task.sourceSeriesId)?.sourceSeriesId;
            return (
              <article key={run.id} className="rounded-sm border border-border-subtle bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-sm bg-surface-raised px-2 py-0.5 font-mono text-[10px] text-text-faint">{run.status}</span>
                  <span className="font-mono text-[11px] text-text-faint">{run.id.slice(0, 8)}</span>
                  {sourceSeriesId && <span className="font-mono text-[11px] text-text-muted">{sourceSeriesId}</span>}
                  <span className="text-xs text-text-muted">{run.doneTasks}/{run.totalTasks} done</span>
                  {run.failedTasks > 0 && <span className="text-xs text-dropped">{run.failedTasks} failed</span>}
                </div>
                <div className="mt-2 space-y-1">
                  {run.tasks.slice(0, 8).map((task) => (
                    <div key={task.id} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-[10px] text-text-faint">{task.state}</span>
                      <span className="font-mono text-[10px] text-text-faint">{task.sourceChapterId ?? "-"}</span>
                      <span className="text-text-muted">attempt {task.attempt}/{task.maxAttempts}</span>
                      {task.lastError && <span className="truncate text-dropped">{task.lastError}</span>}
                    </div>
                  ))}
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
