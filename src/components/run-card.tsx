"use client";

/**
 * RunCard — the shared shape for "something is happening in the background."
 *
 * Downloads, Cache, and Updates all render the same essential artifact: a
 * titled row with a status dot, a counter, optional tasks, and cancel/retry
 * actions. Before extraction, each page re-implemented this ~250 lines of
 * layout code with slightly different variables — which meant any change to
 * the "how a run feels" had to be made in three places and usually drifted.
 *
 * This component normalises the data shape so each caller can hand over its
 * own run record (download task, cache task, scheduled rule) and render
 * consistently.
 */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { ProgressLine } from "@/components/ui/progress-line";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type RunStatus =
  | "queued"
  | "running"
  | "canceling"
  | "succeeded"
  | "failed"
  | "canceled";

export type TaskState =
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export interface RunCardTask {
  id: string;
  chapterLabel: string;
  chapterTitle?: string | null;
  state: TaskState;
  /** e.g. `5/12` for pages completed on a cache task */
  pageLabel?: string | null;
  /** retry count on download tasks, undefined elsewhere */
  attempt?: number;
  error?: string | null;
}

export interface RunCardData {
  id: string;
  title: string | null;
  /** internal href for the title link; falls back to showing as text */
  titleHref?: string | null;
  status: RunStatus;
  /** e.g. "Running", "Caching", "Done" */
  statusLabel: string;
  totalTasks: number;
  doneTasks: number;
  failedTasks: number;
  /** unix ms — timestamp for the "x ago" stamp */
  updatedAtTime: number | null;
  /** e.g. "Download", "Bulk cache", "Remove" */
  kind: string;
  /** optional tail, usually scope.reason like "bulk:next10" */
  kindDetail?: string | null;
  tasks?: RunCardTask[];
}

export interface RunCardActions {
  onCancelRun?: () => void;
  onCancelSeries?: () => void;
  onRetry?: () => void;
  cancelRunBusy?: boolean;
  cancelSeriesBusy?: boolean;
  retryBusy?: boolean;
}

const STATUS_DOT: Record<RunStatus, string> = {
  queued: "bg-text-faint",
  running: "bg-reading animate-pulse",
  canceling: "bg-paused animate-pulse",
  succeeded: "bg-completed",
  failed: "bg-dropped",
  canceled: "bg-text-faint",
};

const STATUS_LABEL_COLOR: Record<RunStatus, string> = {
  queued: "text-text-faint",
  running: "text-reading",
  canceling: "text-paused",
  succeeded: "text-completed",
  failed: "text-dropped",
  canceled: "text-text-faint",
};

const TASK_DOT: Record<TaskState, string> = {
  pending: "bg-text-faint",
  queued: "bg-text-faint",
  running: "bg-reading animate-pulse",
  succeeded: "bg-completed",
  failed: "bg-dropped",
  canceled: "bg-text-faint",
};

function formatTimeAgo(timestamp: number | null): string {
  if (!timestamp) return "—";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function RunCard({
  data,
  actions,
  extraTail,
}: {
  data: RunCardData;
  actions?: RunCardActions;
  /** optional trailing content on the meta row — used sparingly */
  extraTail?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const isActive =
    data.status === "queued" ||
    data.status === "running" ||
    data.status === "canceling";
  const progress = data.totalTasks > 0 ? data.doneTasks / data.totalTasks : 0;
  const kindLine = data.kindDetail
    ? `${data.kind} · ${data.kindDetail}`
    : data.kind;
  const tasks = data.tasks ?? [];

  return (
    <article className="overflow-hidden rounded-sm border border-border-subtle bg-surface">
      <div className="space-y-2 px-3 py-2.5">
        {/* Row 1: status dot + title + expand toggle */}
        <div className="flex items-center gap-2">
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[data.status])}
          />
          <div className="min-w-0 flex-1">
            {data.title && data.titleHref ? (
              <Link
                href={data.titleHref}
                className="block truncate text-sm font-medium text-text transition-colors hover:text-accent"
              >
                {data.title}
              </Link>
            ) : data.title ? (
              <span className="block truncate text-sm font-medium text-text">
                {data.title}
              </span>
            ) : (
              <span className="font-mono text-xs text-text-faint">
                {data.id.slice(0, 8)}
              </span>
            )}
          </div>
          <span
            className={cn(
              "shrink-0 font-mono text-[11px] lowercase tracking-[0.04em]",
              STATUS_LABEL_COLOR[data.status],
            )}
          >
            {data.statusLabel}
          </span>
          {tasks.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="shrink-0 rounded-sm p-1 text-text-faint transition-colors hover:text-text-muted"
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

        {/* Row 2: meta + counters + time + actions */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="font-mono text-[10px] text-text-faint">{kindLine}</span>
          <span className="font-mono tabular-nums text-xs text-text-muted">
            {data.doneTasks}
            <span className="text-text-faint">/{data.totalTasks}</span>
          </span>
          {data.failedTasks > 0 && (
            <span className="font-mono text-xs text-dropped">
              {data.failedTasks} failed
            </span>
          )}
          <span className="font-mono text-[10px] text-text-faint">
            {formatTimeAgo(data.updatedAtTime)}
          </span>
          {extraTail}

          {actions && (
            <div className="flex items-center gap-1 sm:ml-auto">
              {isActive && actions.onCancelRun && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={actions.onCancelRun}
                  disabled={
                    actions.cancelRunBusy || data.status === "canceling"
                  }
                  leading={<XCircle className="h-3 w-3" />}
                  className="hover:text-dropped"
                >
                  Cancel run
                </Button>
              )}
              {isActive && actions.onCancelSeries && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={actions.onCancelSeries}
                  disabled={
                    actions.cancelSeriesBusy || data.status === "canceling"
                  }
                  leading={<XCircle className="h-3 w-3" />}
                  className="hover:text-dropped"
                >
                  Cancel series
                </Button>
              )}
              {data.status === "failed" && actions.onRetry && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={actions.onRetry}
                  disabled={actions.retryBusy}
                  leading={<RotateCcw className="h-3 w-3" />}
                >
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {isActive && data.totalTasks > 0 && (
        <ProgressLine value={progress} className="rounded-none" />
      )}

      {expanded && tasks.length > 0 && (
        <div className="space-y-0.5 border-t border-border-subtle px-3 py-2">
          {tasks.slice(0, 30).map((task) => (
            <div
              key={task.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 text-[11px]"
            >
              <span
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TASK_DOT[task.state])}
              />
              <span className="w-12 shrink-0 font-mono text-text-muted sm:w-16">
                {task.chapterLabel}
              </span>
              {task.chapterTitle && (
                <span className="min-w-0 flex-1 truncate text-text-faint">
                  {task.chapterTitle}
                </span>
              )}
              {task.pageLabel && (
                <span className="shrink-0 font-mono text-text-faint tabular-nums">
                  {task.pageLabel}
                </span>
              )}
              <span className="shrink-0 font-mono text-text-faint">
                {task.state}
              </span>
              {task.attempt && task.attempt > 1 && (
                <span className="shrink-0 font-mono text-text-faint">
                  ×{task.attempt}
                </span>
              )}
              {task.error && (
                <span className="w-full truncate text-dropped sm:w-auto sm:max-w-[240px]">
                  {task.error}
                </span>
              )}
            </div>
          ))}
          {tasks.length > 30 && (
            <p className="pt-1 font-mono text-[10px] text-text-faint">
              +{tasks.length - 30} more
            </p>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Shared history section — a collapsible "previously run" list with
 * paginated load more. All three system pages share this exact pattern,
 * so we lift it out alongside RunCard.
 */
export function RunHistory<T extends { id: string }>({
  label = "History",
  items,
  renderItem,
}: {
  label?: string;
  items: T[];
  renderItem: (item: T) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pageSize, setPageSize] = useState(20);

  if (items.length === 0) return null;

  return (
    <section className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">
          {label}
        </span>
        <span className="font-mono text-[10px] text-text-faint">
          ({items.length})
        </span>
        {expanded ? (
          <ChevronUp className="h-3 w-3 text-text-faint" />
        ) : (
          <ChevronDown className="h-3 w-3 text-text-faint" />
        )}
      </button>

      {expanded && (
        <>
          {items.slice(0, pageSize).map(renderItem)}
          {items.length > pageSize && (
            <button
              type="button"
              onClick={() => setPageSize((n) => n + 20)}
              className="w-full rounded-sm border border-border-subtle py-1.5 text-xs text-text-faint transition-colors hover:border-border hover:text-text-muted"
            >
              Load {Math.min(20, items.length - pageSize)} more
            </button>
          )}
        </>
      )}
    </section>
  );
}
