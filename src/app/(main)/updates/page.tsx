"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Play, Trash2, RefreshCw } from "lucide-react";

type TargetType = "all" | "status_bucket" | "smart_unread";

interface RuleRecord {
  id: string;
  name: string;
  enabled: boolean;
  targetType: TargetType;
  targetValue: unknown;
  intervalMinutes: number;
  jitterSeconds: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
}

interface UpdateRunRecord {
  id: string;
  status: string;
  trigger: string;
  totalTasks: number;
  doneTasks: number;
  failedTasks: number;
  createdAt: string | null;
  scope: {
    reason?: string;
    scheduleId?: string;
  } | null;
}

export default function UpdatesPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [runs, setRuns] = useState<UpdateRunRecord[]>([]);

  const [name, setName] = useState("Reading updates");
  const [targetType, setTargetType] = useState<TargetType>("status_bucket");
  const [statusesCsv, setStatusesCsv] = useState("reading,planning");
  const [intervalMinutes, setIntervalMinutes] = useState("60");

  async function load() {
    const [rulesRes, runsRes] = await Promise.all([
      fetch("/api/updates/rules"),
      fetch("/api/updates/runs?limit=30"),
    ]);

    if (rulesRes.ok) {
      const body = await rulesRes.json() as { rules: RuleRecord[] };
      setRules(body.rules ?? []);
    }

    if (runsRes.ok) {
      const body = await runsRes.json() as { runs: UpdateRunRecord[] };
      setRuns(body.runs ?? []);
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
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const interval = Number.parseInt(intervalMinutes, 10);
    if (!name.trim() || !Number.isFinite(interval) || interval <= 0) {
      return;
    }

    let targetValue: unknown = null;
    if (targetType === "status_bucket") {
      const statuses = statusesCsv
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      targetValue = { statuses };
    }

    setBusy("create");
    try {
      await fetch("/api/updates/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          enabled: true,
          targetType,
          targetValue,
          intervalMinutes: interval,
          jitterSeconds: 30,
        }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function toggleRule(rule: RuleRecord) {
    setBusy(`toggle:${rule.id}`);
    try {
      await fetch(`/api/updates/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function runRuleNow(ruleId: string) {
    setBusy(`run:${ruleId}`);
    try {
      await fetch(`/api/updates/rules/${ruleId}/run`, { method: "POST" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function deleteRule(ruleId: string) {
    setBusy(`delete:${ruleId}`);
    try {
      await fetch(`/api/updates/rules/${ruleId}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function runLibraryUpdateNow() {
    setBusy("run-all");
    try {
      await fetch("/api/library/refresh", { method: "POST" });
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
          <h1 className="font-display text-3xl leading-none text-text">Updates</h1>
          <p className="mt-1 text-xs text-text-faint">Scheduled and manual library update jobs.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void runLibraryUpdateNow()}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            Run all now
          </button>
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

      <section className="rounded-sm border border-border-subtle bg-surface p-3">
        <p className="mb-3 text-[10px] uppercase tracking-[0.14em] text-text-faint">Create update rule</p>
        <form onSubmit={createRule} className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Rule name"
            className="rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-xs text-text"
          />

          <select
            value={targetType}
            onChange={(event) => setTargetType(event.target.value as TargetType)}
            className="rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-xs text-text"
          >
            <option value="all">All library</option>
            <option value="status_bucket">Status buckets</option>
            <option value="smart_unread">Unread smart set</option>
          </select>

          <input
            value={statusesCsv}
            onChange={(event) => setStatusesCsv(event.target.value)}
            placeholder="Statuses csv"
            className="rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-xs text-text"
            disabled={targetType !== "status_bucket"}
          />

          <input
            value={intervalMinutes}
            onChange={(event) => setIntervalMinutes(event.target.value)}
            placeholder="Interval (min)"
            className="rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-xs text-text"
          />

          <button
            type="submit"
            disabled={busy !== null}
            className="rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            Create rule
          </button>
        </form>
      </section>

      <section className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Rules</p>
        {rules.length === 0 ? (
          <p className="text-sm text-text-faint">No update rules yet.</p>
        ) : (
          rules.map((rule) => (
            <article key={rule.id} className="rounded-sm border border-border-subtle bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm text-text">{rule.name}</span>
                <span className="rounded-sm bg-surface-raised px-2 py-0.5 font-mono text-[10px] text-text-faint">{rule.enabled ? "enabled" : "disabled"}</span>
                <span className="font-mono text-[10px] text-text-faint">{rule.targetType}</span>
                <span className="font-mono text-[10px] text-text-faint">every {rule.intervalMinutes}m</span>
                {rule.nextRunAt && <span className="font-mono text-[10px] text-text-faint">next {new Date(rule.nextRunAt).toLocaleString()}</span>}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => void toggleRule(rule)}
                  disabled={busy !== null}
                  className="rounded-sm border border-border px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  {rule.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  onClick={() => void runRuleNow(rule.id)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded-sm border border-border px-2.5 py-1 text-[11px] text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  <Play className="h-3 w-3" />
                  Run
                </button>
                <button
                  type="button"
                  onClick={() => void deleteRule(rule.id)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded-sm border border-border px-2.5 py-1 text-[11px] text-dropped transition-colors hover:bg-dropped/10 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </div>
            </article>
          ))
        )}
      </section>

      <section className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Recent update runs</p>
        {runs.length === 0 ? (
          <p className="text-sm text-text-faint">No update runs yet.</p>
        ) : (
          runs.map((run) => (
            <article key={run.id} className="rounded-sm border border-border-subtle bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-sm bg-surface-raised px-2 py-0.5 font-mono text-[10px] text-text-faint">{run.status}</span>
                <span className="font-mono text-[10px] text-text-faint">{run.id.slice(0, 8)}</span>
                <span className="font-mono text-[10px] text-text-faint">{run.trigger}</span>
                <span className="text-xs text-text-muted">{run.doneTasks}/{run.totalTasks} done</span>
                {run.failedTasks > 0 && <span className="text-xs text-dropped">{run.failedTasks} failed</span>}
                {run.scope?.reason && <span className="text-xs text-text-faint">{run.scope.reason}</span>}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
