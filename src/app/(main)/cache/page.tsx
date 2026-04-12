"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    Loader2,
    XCircle,
    RefreshCw,
    Activity,
    ChevronDown,
    ChevronUp,
    RotateCcw,
    Trash2,
    HardDrive,
} from "lucide-react";
import { ProgressLine } from "@/components/ui/progress-line";
import { cn } from "@/lib/utils";
import { buildReaderHref, buildSeriesHref } from "@/lib/reader/url";
import {
    cancelAllRuns,
    cancelRun,
    retryRun,
    useCacheQueue,
    type CacheRun,
    type CacheRunStatus,
} from "@/lib/offline/cache-queue";
import { formatCacheBytes } from "@/lib/offline/cache-actions";
import {
    getStorageEstimate,
    listAllCachedChapters,
    removeChapterFromDevice,
} from "@/lib/offline/device-cache";
import type { CachedChapterEntry } from "@/lib/offline/cache-db";

const STATUS_CFG: Record<CacheRunStatus, { label: string; dotClass: string; labelClass: string }> = {
    queued: { label: "Queued", dotClass: "bg-text-faint", labelClass: "text-text-faint" },
    running: { label: "Caching", dotClass: "bg-reading animate-pulse", labelClass: "text-reading" },
    canceling: { label: "Canceling", dotClass: "bg-paused animate-pulse", labelClass: "text-paused" },
    succeeded: { label: "Cached", dotClass: "bg-completed", labelClass: "text-completed" },
    failed: { label: "Failed", dotClass: "bg-dropped", labelClass: "text-dropped" },
    canceled: { label: "Canceled", dotClass: "bg-text-faint", labelClass: "text-text-faint" },
};

function timeAgo(timestamp: number | null): string {
    if (!timestamp) return "—";
    const diff = Date.now() - timestamp;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatRunKind(run: CacheRun) {
    if (run.tasks.some((task) => task.kind === "delete")) return "Remove";
    const reason = run.scope?.reason ?? run.trigger;
    if (reason?.includes("bulk:")) return "Bulk cache";
    if (reason?.startsWith("single")) return "Cache";
    return "Cache";
}

function RunCard({
    run,
    onCancelRun,
    onRetry,
    cancelBusy,
    retryBusy,
}: {
    run: CacheRun;
    onCancelRun?: () => void;
    onRetry?: () => void;
    cancelBusy: boolean;
    retryBusy?: boolean;
}) {
    const [expanded, setExpanded] = useState(false);
    const cfg = STATUS_CFG[run.status];
    const firstTask = run.tasks[0];
    const seriesId = run.scope?.sourceSeriesId ?? firstTask?.seriesId;
    const seriesTitle = firstTask?.seriesTitle ?? seriesId;
    const doneTasks = run.tasks.filter(
        (task) => task.state === "succeeded" || task.state === "failed" || task.state === "canceled",
    ).length;
    const failedTasks = run.tasks.filter((task) => task.state === "failed").length;
    const totalTasks = run.tasks.length;
    const isActive = run.status === "queued" || run.status === "running" || run.status === "canceling";
    const progress = totalTasks > 0 ? doneTasks / totalTasks : 0;
    const runKind = formatRunKind(run);
    const runMeta = run.scope?.reason ? `${runKind} · ${run.scope.reason}` : runKind;

    return (
        <article className="overflow-hidden rounded-sm border border-border-subtle bg-surface">
            <div className="space-y-2 px-3 py-2.5">
                <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", cfg.dotClass)} />
                    <div className="min-w-0 flex-1">
                        {seriesId ? (
                            <Link
                                href={buildSeriesHref(seriesId, firstTask?.sourceName ?? null)}
                                className="block truncate text-sm font-medium text-text transition-colors hover:text-accent"
                            >
                                {seriesTitle ?? seriesId}
                            </Link>
                        ) : (
                            <span className="font-mono text-xs text-text-faint">{run.id.slice(0, 8)}</span>
                        )}
                    </div>
                    <span className={cn("shrink-0 text-[11px] font-medium", cfg.labelClass)}>{cfg.label}</span>
                    {run.tasks.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setExpanded((v) => !v)}
                            className="shrink-0 rounded-sm p-1 text-text-faint transition-colors hover:text-text-muted"
                            aria-label={expanded ? "Collapse tasks" : "Expand tasks"}
                        >
                            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="text-[10px] text-text-faint">{runMeta}</span>
                    <span className="tabular-nums text-xs text-text-muted">
                        {doneTasks}
                        <span className="text-text-faint">/{totalTasks}</span>
                    </span>
                    {failedTasks > 0 && <span className="text-xs text-dropped">{failedTasks} failed</span>}
                    <span className="text-[10px] text-text-faint">{timeAgo(run.updatedAt)}</span>

                    <div className="flex items-center gap-1 sm:ml-auto">
                        {isActive && onCancelRun && (
                            <button
                                type="button"
                                onClick={onCancelRun}
                                disabled={cancelBusy || run.status === "canceling"}
                                className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[11px] text-text-faint transition-colors hover:border-dropped/50 hover:text-dropped disabled:opacity-50"
                            >
                                <XCircle className="h-3 w-3" />
                                <span className="hidden sm:inline">Cancel</span> run
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
                    </div>
                </div>
            </div>

            {isActive && totalTasks > 0 && <ProgressLine value={progress} className="rounded-none" />}

            {expanded && run.tasks.length > 0 && (
                <div className="space-y-0.5 border-t border-border-subtle px-3 py-2">
                    {run.tasks.slice(0, 30).map((task) => {
                        const chapterLabel = `Ch. ${task.chapterNo % 1 === 0 ? task.chapterNo.toFixed(0) : task.chapterNo}`;
                        const stateClass =
                            task.state === "succeeded"
                                ? "bg-completed"
                                : task.state === "failed"
                                    ? "bg-dropped"
                                    : task.state === "running"
                                        ? "bg-reading animate-pulse"
                                        : "bg-text-faint";
                        const pageLabel =
                            task.totalPages > 0 ? `${task.loadedPages}/${task.totalPages}` : null;
                        return (
                            <div
                                key={task.id}
                                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 text-[11px]"
                            >
                                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stateClass)} />
                                <span className="w-12 shrink-0 font-mono text-text-muted sm:w-16">
                                    {chapterLabel}
                                </span>
                                {task.chapterTitle && (
                                    <span className="min-w-0 flex-1 truncate text-text-faint">
                                        {task.chapterTitle}
                                    </span>
                                )}
                                {pageLabel && (
                                    <span className="shrink-0 text-text-faint tabular-nums">{pageLabel}</span>
                                )}
                                <span className="shrink-0 text-text-faint">{task.state}</span>
                                {task.error && (
                                    <span className="w-full truncate text-dropped sm:w-auto sm:max-w-[240px]">
                                        {task.error}
                                    </span>
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

interface ChapterBySeries {
    seriesId: string;
    seriesTitle: string;
    sourceName: string | null;
    coverUrl: string | null;
    chapters: CachedChapterEntry[];
    bytes: number;
}

function groupChaptersBySeries(chapters: CachedChapterEntry[]): ChapterBySeries[] {
    const byKey = new Map<string, ChapterBySeries>();
    for (const entry of chapters) {
        const key = `${entry.seriesId}::${entry.sourceName ?? ""}`;
        let group = byKey.get(key);
        if (!group) {
            group = {
                seriesId: entry.seriesId,
                seriesTitle: entry.seriesTitle ?? entry.seriesId,
                sourceName: entry.sourceName,
                coverUrl: entry.seriesCoverUrl,
                chapters: [],
                bytes: 0,
            };
            byKey.set(key, group);
        }
        group.chapters.push(entry);
        group.bytes += entry.bytes;
    }
    const groups = Array.from(byKey.values());
    for (const group of groups) {
        group.chapters.sort((left, right) => right.chapterNo - left.chapterNo);
    }
    groups.sort((left, right) => left.seriesTitle.localeCompare(right.seriesTitle));
    return groups;
}

export default function CachePage() {
    const { runs } = useCacheQueue();
    const [loading, setLoading] = useState(true);
    const [cached, setCached] = useState<CachedChapterEntry[]>([]);
    const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [historyPageSize, setHistoryPageSize] = useState(20);
    const [expandedSeriesKey, setExpandedSeriesKey] = useState<string | null>(null);

    async function load() {
        const [chapters, estimate] = await Promise.all([listAllCachedChapters(), getStorageEstimate()]);
        setCached(chapters);
        setStorage(estimate);
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
        return () => {
            cancelled = true;
        };
    }, []);

    // Refresh the registry whenever a run completes so new entries appear.
    const runSignature = runs
        .filter((run) => run.status === "succeeded" || run.status === "failed" || run.status === "canceled")
        .map((run) => `${run.id}:${run.updatedAt}`)
        .join("|");
    useEffect(() => {
        void load();
    }, [runSignature]);

    const activeRuns = useMemo(
        () =>
            runs.filter(
                (run) =>
                    run.status === "queued" || run.status === "running" || run.status === "canceling",
            ),
        [runs],
    );
    const historyRuns = useMemo(
        () =>
            runs.filter(
                (run) => run.status === "succeeded" || run.status === "failed" || run.status === "canceled",
            ),
        [runs],
    );

    const seriesGroups = useMemo(() => groupChaptersBySeries(cached), [cached]);
    const totalBytes = useMemo(() => cached.reduce((sum, entry) => sum + entry.bytes, 0), [cached]);
    const totalChapters = useMemo(
        () => cached.filter((entry) => entry.state === "ready" || entry.state === "partial").length,
        [cached],
    );

    async function handleRemoveChapter(entry: CachedChapterEntry) {
        setBusy(`remove-${entry.key}`);
        try {
            await removeChapterFromDevice(entry.seriesId, entry.chapterId);
            await load();
        } finally {
            setBusy(null);
        }
    }

    async function handleRemoveSeries(group: ChapterBySeries) {
        if (!window.confirm(`Remove all ${group.chapters.length} cached chapter(s) for "${group.seriesTitle}"?`)) {
            return;
        }
        setBusy(`remove-series-${group.seriesId}`);
        try {
            await Promise.allSettled(
                group.chapters.map((chapter) =>
                    removeChapterFromDevice(chapter.seriesId, chapter.chapterId),
                ),
            );
            await load();
        } finally {
            setBusy(null);
        }
    }

    async function handleRefresh() {
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

    const quotaPct = storage && storage.quota > 0 ? storage.usage / storage.quota : 0;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="font-display text-3xl leading-none text-text">Cache</h1>
                    <p className="mt-1 text-xs text-text-faint">
                        Chapters saved on this device. Works offline.
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {activeRuns.length > 0 && (
                        <button
                            type="button"
                            onClick={() => cancelAllRuns()}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2 py-1.5 text-xs text-text-muted transition-colors hover:border-dropped/50 hover:text-dropped disabled:opacity-50"
                        >
                            <XCircle className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Cancel all</span>
                            <span className="sm:hidden">Cancel</span>
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => void handleRefresh()}
                        disabled={busy === "refresh"}
                        className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                        <RefreshCw className={cn("h-3.5 w-3.5", busy === "refresh" && "animate-spin")} />
                        <span className="hidden sm:inline">
                            {busy === "refresh" ? "Refreshing…" : "Refresh"}
                        </span>
                    </button>
                </div>
            </div>

            {/* Storage summary */}
            <div className="space-y-2 rounded-sm border border-border-subtle bg-surface px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <div className="flex items-center gap-2">
                        <HardDrive className="h-3.5 w-3.5 text-text-faint" />
                        <span className="text-text-muted">
                            {totalChapters} chapter{totalChapters === 1 ? "" : "s"} · {formatCacheBytes(totalBytes)}
                        </span>
                    </div>
                    {storage && storage.quota > 0 && (
                        <span className="text-text-faint">
                            Device storage{" "}
                            <span className="text-text-muted">
                                {formatCacheBytes(storage.usage)} / {formatCacheBytes(storage.quota)}
                            </span>
                        </span>
                    )}
                </div>
                {storage && storage.quota > 0 && (
                    <div className="h-1 overflow-hidden rounded-full bg-surface-raised">
                        <div
                            className={cn(
                                "h-full transition-all duration-300",
                                quotaPct > 0.9 ? "bg-dropped" : quotaPct > 0.75 ? "bg-paused" : "bg-accent",
                            )}
                            style={{ width: `${Math.min(100, Math.round(quotaPct * 100))}%` }}
                        />
                    </div>
                )}
            </div>

            {/* Active runs */}
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
                        No active caching
                    </div>
                ) : (
                    activeRuns.map((run) => (
                        <RunCard
                            key={run.id}
                            run={run}
                            cancelBusy={busy === `cancel-run-${run.id}`}
                            onCancelRun={() => cancelRun(run.id)}
                        />
                    ))
                )}
            </section>

            {/* Cached library */}
            <section className="space-y-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Cached on this device</p>
                {seriesGroups.length === 0 ? (
                    <div className="rounded-sm border border-border-subtle bg-surface px-3 py-6 text-center text-xs text-text-faint">
                        Nothing cached yet. Open a series and tap <span className="font-medium text-text-muted">Cache</span> to save
                        chapters for offline reading.
                    </div>
                ) : (
                    seriesGroups.map((group) => {
                        const key = `${group.seriesId}::${group.sourceName ?? ""}`;
                        const expanded = expandedSeriesKey === key;
                        return (
                            <article
                                key={key}
                                className="overflow-hidden rounded-sm border border-border-subtle bg-surface"
                            >
                                <div className="flex items-center gap-3 px-3 py-2.5">
                                    <div className="min-w-0 flex-1">
                                        <Link
                                            href={buildSeriesHref(group.seriesId, group.sourceName)}
                                            className="block truncate text-sm font-medium text-text transition-colors hover:text-accent"
                                        >
                                            {group.seriesTitle}
                                        </Link>
                                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-text-faint">
                                            <span>
                                                {group.chapters.length} chapter{group.chapters.length === 1 ? "" : "s"}
                                            </span>
                                            <span>·</span>
                                            <span>{formatCacheBytes(group.bytes)}</span>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setExpandedSeriesKey(expanded ? null : key)}
                                        className="rounded-sm p-1 text-text-faint transition-colors hover:text-text-muted"
                                        aria-label={expanded ? "Collapse" : "Expand"}
                                    >
                                        {expanded ? (
                                            <ChevronUp className="h-3.5 w-3.5" />
                                        ) : (
                                            <ChevronDown className="h-3.5 w-3.5" />
                                        )}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handleRemoveSeries(group)}
                                        disabled={busy === `remove-series-${group.seriesId}`}
                                        className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[11px] text-text-faint transition-colors hover:border-dropped/50 hover:text-dropped disabled:opacity-50"
                                        aria-label="Remove all cached chapters for this series"
                                    >
                                        <Trash2 className="h-3 w-3" />
                                        <span className="hidden sm:inline">Remove all</span>
                                    </button>
                                </div>
                                {expanded && (
                                    <div className="divide-y divide-border-subtle border-t border-border-subtle">
                                        {group.chapters.map((chapter) => {
                                            const chapterLabel = `Ch. ${chapter.chapterNo % 1 === 0 ? chapter.chapterNo.toFixed(0) : chapter.chapterNo}`;
                                            return (
                                                <div
                                                    key={chapter.key}
                                                    className="flex items-center gap-2 px-3 py-1.5 text-[11px]"
                                                >
                                                    <Link
                                                        href={buildReaderHref(
                                                            chapter.seriesId,
                                                            chapter.chapterId,
                                                            chapter.sourceName,
                                                        )}
                                                        className="flex min-w-0 flex-1 items-center gap-2 text-text-muted transition-colors hover:text-accent"
                                                    >
                                                        <span className="w-12 shrink-0 font-mono text-text-muted sm:w-16">
                                                            {chapterLabel}
                                                        </span>
                                                        {chapter.title && (
                                                            <span className="min-w-0 flex-1 truncate text-text-faint">
                                                                {chapter.title}
                                                            </span>
                                                        )}
                                                    </Link>
                                                    <span className="shrink-0 text-text-faint tabular-nums">
                                                        {formatCacheBytes(chapter.bytes)}
                                                    </span>
                                                    {chapter.state === "partial" && (
                                                        <span className="shrink-0 text-paused">partial</span>
                                                    )}
                                                    {chapter.state === "pending" && (
                                                        <span className="shrink-0 text-text-faint">pending</span>
                                                    )}
                                                    {chapter.state === "failed" && (
                                                        <span className="shrink-0 text-dropped">failed</span>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleRemoveChapter(chapter)}
                                                        disabled={busy === `remove-${chapter.key}`}
                                                        className="rounded-sm p-1 text-text-faint transition-colors hover:text-dropped disabled:opacity-50"
                                                        aria-label="Remove from cache"
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </article>
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
                        <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint">History</span>
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
                                    cancelBusy={false}
                                    onRetry={run.status === "failed" ? () => void retryRun(run.id) : undefined}
                                />
                            ))}
                            {historyRuns.length > historyPageSize && (
                                <button
                                    type="button"
                                    onClick={() => setHistoryPageSize((n) => n + 20)}
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
