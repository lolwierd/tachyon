"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Play, Trash2, RefreshCw, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type TargetType = "all" | "status_bucket" | "smart_unread";

const TARGET_LABELS: Record<TargetType, string> = {
  all: "All library",
  status_bucket: "Status buckets",
  smart_unread: "Unread smart set",
};

const LIBRARY_STATUSES = [
  { value: "reading", label: "Reading", activeClass: "bg-reading/15 text-reading border-reading/30" },
  { value: "planning", label: "Planning", activeClass: "bg-planning/15 text-planning border-planning/30" },
  { value: "completed", label: "Completed", activeClass: "bg-completed/15 text-completed border-completed/30" },
  { value: "paused", label: "Paused", activeClass: "bg-paused/15 text-paused border-paused/30" },
  { value: "rereading", label: "Rereading", activeClass: "bg-rereading/15 text-rereading border-rereading/30" },
  { value: "dropped", label: "Dropped", activeClass: "bg-dropped/15 text-dropped border-dropped/30" },
] as const;

const INTERVAL_PRESETS = [
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "3h", minutes: 180 },
  { label: "6h", minutes: 360 },
  { label: "12h", minutes: 720 },
  { label: "24h", minutes: 1440 },
];

const RUN_STATUS_CFG: Record<string, { label: string; dotClass: string; labelClass: string }> = {
  queued: { label: "queued", dotClass: "bg-text-faint", labelClass: "text-text-faint" },
  running: { label: "running", dotClass: "bg-reading animate-pulse", labelClass: "text-reading" },
  canceling: { label: "canceling", dotClass: "bg-paused animate-pulse", labelClass: "text-paused" },
  succeeded: { label: "done", dotClass: "bg-completed", labelClass: "text-completed" },
  failed: { label: "failed", dotClass: "bg-dropped", labelClass: "text-dropped" },
  canceled: { label: "canceled", dotClass: "bg-text-faint", labelClass: "text-text-faint" },
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: "Manual",
  schedule: "Scheduled",
  automation: "Auto",
};

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
  scope: { reason?: string; scheduleId?: string } | null;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function timeUntil(dateStr: string | null): string {
  if (!dateStr) return "—";
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return "due now";
  if (diff < 60_000) return "< 1m";
  if (diff < 3_600_000) return `in ${Math.ceil(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${Math.ceil(diff / 3_600_000)}h`;
  return `in ${Math.ceil(diff / 86_400_000)}d`;
}

function formatInterval(minutes: number): string {
  if (minutes < 60) return `every ${minutes}m`;
  if (minutes % 60 === 0) return `every ${minutes / 60}h`;
  return `every ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function getTargetSummary(rule: RuleRecord): string {
  if (rule.targetType === "status_bucket") {
    const value = rule.targetValue as { statuses?: string[] } | null;
    if (value?.statuses && value.statuses.length > 0) {
      return value.statuses.join(", ");
    }
  }
  return TARGET_LABELS[rule.targetType] ?? rule.targetType;
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 overflow-hidden rounded-full p-0.5 transition-colors duration-200 disabled:opacity-50",
        checked ? "bg-accent" : "bg-border",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-[color:var(--color-text-on-accent)] shadow-sm transition-transform duration-200",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

export default function UpdatesPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [runs, setRuns] = useState<UpdateRunRecord[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);

  const [name, setName] = useState("Reading updates");
  const [targetType, setTargetType] = useState<TargetType>("status_bucket");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["reading", "planning"]);
  const [intervalMinutes, setIntervalMinutes] = useState(60);

  async function load() {
    const [rulesRes, runsRes] = await Promise.all([
      fetch("/api/updates/rules", { cache: "no-store" }),
      fetch("/api/updates/runs?limit=30", { cache: "no-store" }),
    ]);

    if (rulesRes.ok) {
      const body = (await rulesRes.json()) as { rules: RuleRecord[] };
      setRules(body.rules ?? []);
    }

    if (runsRes.ok) {
      const body = (await runsRes.json()) as { runs: UpdateRunRecord[] };
      setRuns(body.runs ?? []);
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
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || intervalMinutes <= 0) return;
    if (targetType === "status_bucket" && selectedStatuses.length === 0) return;

    const targetValue =
      targetType === "status_bucket" ? { statuses: selectedStatuses } : null;

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
          intervalMinutes,
          jitterSeconds: 30,
        }),
      });
      setName("Reading updates");
      setSelectedStatuses(["reading", "planning"]);
      setIntervalMinutes(60);
      setComposerOpen(false);
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

  async function refresh() {
    setBusy("refresh");
    try {
      await load();
    } finally {
      setBusy(null);
    }
  }

  function toggleStatus(status: string) {
    setSelectedStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
    );
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
          <h1 className="font-display text-3xl leading-none text-text">Updates</h1>
          <p className="mt-1 font-display italic text-sm text-text-faint">
            Standing orders &mdash; the rounds your library walks on a timer.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              if (!window.confirm("Run a full library update for all series? This may take a while.")) return;
              void runLibraryUpdateNow();
            }}
            disabled={busy !== null}
            leading={<Play className="h-3.5 w-3.5" />}
          >
            <span className="hidden sm:inline">Run all now</span>
            <span className="sm:hidden">Run all</span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => void refresh()}
            disabled={busy === "refresh"}
            leading={<RefreshCw className={cn("h-3.5 w-3.5", busy === "refresh" && "animate-spin")} />}
          >
            <span className="hidden sm:inline">{busy === "refresh" ? "Refreshing…" : "Refresh"}</span>
          </Button>
        </div>
      </div>

      {/* Rules */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">
            Rules
          </p>
          {!composerOpen && (
            <Button
              variant="seal"
              size="xs"
              onClick={() => setComposerOpen(true)}
              leading={<Plus className="h-3 w-3" />}
            >
              New rule
            </Button>
          )}
        </div>
        {rules.length === 0 && !composerOpen ? (
          <p className="rounded-sm border border-border-subtle bg-surface px-3 py-4 font-display italic text-sm text-text-faint">
            No standing orders yet.
          </p>
        ) : (
          rules.map((rule) => (
            <article
              key={rule.id}
              className="rounded-sm border border-border-subtle bg-surface px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-3 gap-y-2">
                <Toggle
                  checked={rule.enabled}
                  onChange={() => void toggleRule(rule)}
                  disabled={busy !== null}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span
                      className={cn(
                        "text-sm font-medium",
                        rule.enabled ? "text-text" : "text-text-muted",
                      )}
                    >
                      {rule.name}
                    </span>
                    <span className="text-[11px] text-text-faint">
                      {getTargetSummary(rule)}
                    </span>
                    <span className="rounded-sm bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-text-faint">
                      {formatInterval(rule.intervalMinutes)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[10px] text-text-faint">
                    {rule.lastRunAt && (
                      <span>Last ran {timeAgo(rule.lastRunAt)}</span>
                    )}
                    {rule.nextRunAt && rule.enabled && (
                      <span>Next {timeUntil(rule.nextRunAt)}</span>
                    )}
                    {!rule.enabled && <span>Disabled</span>}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void runRuleNow(rule.id)}
                    disabled={busy !== null}
                    leading={<Play className="h-3 w-3" />}
                  >
                    Run
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => void deleteRule(rule.id)}
                    disabled={busy !== null}
                    aria-label="Delete rule"
                    className="hover:text-dropped"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </article>
          ))
        )}
      </section>

      {/* Composer (opened on demand) */}
      {composerOpen && (
        <section className="rounded-sm border border-accent/40 bg-surface p-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
              New standing order
            </p>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setComposerOpen(false)}
              aria-label="Close composer"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <form onSubmit={createRule} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Rule name"
                  className="w-full rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-xs text-text"
                />
              </div>

              <div className="space-y-1">
                <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">
                  Interval{intervalMinutes >= 60 ? ` — ${formatInterval(intervalMinutes)}` : ""}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {INTERVAL_PRESETS.map((p) => (
                    <Button
                      key={p.minutes}
                      variant="secondary"
                      size="xs"
                      selected={intervalMinutes === p.minutes}
                      onClick={() => setIntervalMinutes(p.minutes)}
                    >
                      {p.label}
                    </Button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    value={intervalMinutes}
                    onChange={(e) => {
                      const v = Number.parseInt(e.target.value, 10);
                      if (Number.isFinite(v) && v > 0) setIntervalMinutes(v);
                    }}
                    className="w-16 rounded-sm border border-border bg-surface-raised px-2 py-1 text-xs text-text"
                    aria-label="Custom interval in minutes"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">Target</label>
              <div className="flex flex-wrap gap-1.5">
                {(["all", "status_bucket", "smart_unread"] as const).map((t) => (
                  <Button
                    key={t}
                    variant="secondary"
                    size="xs"
                    selected={targetType === t}
                    onClick={() => setTargetType(t)}
                  >
                    {TARGET_LABELS[t]}
                  </Button>
                ))}
              </div>
            </div>

            {targetType === "status_bucket" && (
              <div className="space-y-2">
                <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-faint">
                  Statuses
                  {selectedStatuses.length === 0 && (
                    <span className="ml-1 normal-case text-dropped"> — select at least one</span>
                  )}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {LIBRARY_STATUSES.map((s) => {
                    const selected = selectedStatuses.includes(s.value);
                    return (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => toggleStatus(s.value)}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                          selected
                            ? s.activeClass
                            : "border-border text-text-faint hover:text-text-muted",
                        )}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={
                  busy !== null ||
                  !name.trim() ||
                  (targetType === "status_bucket" && selectedStatuses.length === 0)
                }
                loading={busy === "create"}
              >
                {busy === "create" ? "Creating…" : "Create rule"}
              </Button>
              <Button variant="ghost" onClick={() => setComposerOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* Run history */}
      <section className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">Recent runs</p>
        {runs.length === 0 ? (
          <p className="rounded-sm border border-border-subtle bg-surface px-3 py-4 font-display italic text-sm text-text-faint">
            No rounds yet.
          </p>
        ) : (
          <div className="space-y-1">
            {runs.map((run) => {
              const cfg = RUN_STATUS_CFG[run.status] ?? RUN_STATUS_CFG.queued;
              return (
                <div
                  key={run.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-border-subtle bg-surface px-3 py-2"
                >
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", cfg.dotClass)} />
                  <span className={cn("shrink-0 font-mono text-[11px] font-medium", cfg.labelClass)}>
                    {cfg.label}
                  </span>
                  <span className="font-mono tabular-nums text-xs text-text-muted">
                    {run.doneTasks}
                    <span className="text-text-faint">/{run.totalTasks}</span>
                  </span>
                  {run.failedTasks > 0 && (
                    <span className="font-mono text-xs text-dropped">{run.failedTasks} failed</span>
                  )}
                  <span className="font-mono text-[11px] text-text-faint">
                    {TRIGGER_LABELS[run.trigger] ?? run.trigger}
                  </span>
                  {run.scope?.reason && (
                    <span className="w-full truncate font-mono text-[10px] text-text-faint sm:w-auto sm:min-w-0 sm:flex-1">
                      {run.scope.reason}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-text-faint">
                    {timeAgo(run.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
