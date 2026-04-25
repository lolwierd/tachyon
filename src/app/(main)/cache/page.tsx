"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
    Loader2,
    XCircle,
    RefreshCw,
    ChevronDown,
    ChevronUp,
    Trash2,
    HardDrive,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { buildReaderHref, buildSeriesHref } from "@/lib/reader/url";
import {
    cancelAllRuns,
    cancelRun,
    retryRun,
    useCacheQueue,
    type CacheRun,
    type CacheRunStatus,
} from "@/lib/offline/cache-queue";
import {
    getStorageEstimate,
    listAllCachedChapters,
    removeChapterFromDevice,
} from "@/lib/offline/device-cache";
import type { CachedChapterEntry } from "@/lib/offline/cache-db";
import {
    RunCard,
    RunHistory,
    type RunCardData,
    type RunCardTask,
    type TaskState,
    type RunStatus,
} from "@/components/run-card";

const STATUS_LABEL: Record<CacheRunStatus, string> = {
    queued: "queued",
    running: "caching",
    canceling: "canceling",
    succeeded: "cached",
    failed: "failed",
    canceled: "canceled",
};

function runKindOf(run: CacheRun): string {
    if (run.tasks.some((task) => task.kind === "delete")) return "Remove";
    const reason = run.scope?.reason ?? run.trigger;
    if (reason?.includes("bulk:")) return "Bulk cache";
    return "Cache";
}

function normalizeCacheState(raw: string): TaskState {
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

function toRunCardData(run: CacheRun): RunCardData {
    const firstTask = run.tasks[0];
    const seriesId = run.scope?.sourceSeriesId ?? firstTask?.seriesId ?? null;
    const seriesTitle = firstTask?.seriesTitle ?? seriesId;
    const doneTasks = run.tasks.filter(
        (task) =>
            task.state === "succeeded" ||
            task.state === "failed" ||
            task.state === "canceled",
    ).length;
    const failedTasks = run.tasks.filter((task) => task.state === "failed").length;

    const tasks: RunCardTask[] = run.tasks.map((task) => ({
        id: task.id,
        chapterLabel: `Ch. ${task.chapterNo % 1 === 0 ? task.chapterNo.toFixed(0) : task.chapterNo}`,
        chapterTitle: task.chapterTitle,
        state: normalizeCacheState(task.state),
        pageLabel:
            task.totalPages > 0 ? `${task.loadedPages}/${task.totalPages}` : null,
        error: task.error,
    }));

    return {
        id: run.id,
        title: seriesTitle ?? null,
        titleHref: seriesId
            ? buildSeriesHref(seriesId, firstTask?.sourceName ?? null)
            : null,
        status: run.status as RunStatus,
        statusLabel: STATUS_LABEL[run.status],
        totalTasks: run.tasks.length,
        doneTasks,
        failedTasks,
        updatedAtTime: run.updatedAt,
        kind: runKindOf(run),
        kindDetail: run.scope?.reason ?? null,
        tasks,
    };
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
    const [expandedSeriesKey, setExpandedSeriesKey] = useState<string | null>(null);

    async function load() {
        const [chapters, estimate] = await Promise.all([
            listAllCachedChapters(),
            getStorageEstimate(),
        ]);
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

    const runSignature = runs
        .filter(
            (run) =>
                run.status === "succeeded" ||
                run.status === "failed" ||
                run.status === "canceled",
        )
        .map((run) => `${run.id}:${run.updatedAt}`)
        .join("|");
    useEffect(() => {
        void load();
    }, [runSignature]);

    const activeRuns = useMemo(
        () =>
            runs.filter(
                (run) =>
                    run.status === "queued" ||
                    run.status === "running" ||
                    run.status === "canceling",
            ),
        [runs],
    );
    const historyRuns = useMemo(
        () =>
            runs.filter(
                (run) =>
                    run.status === "succeeded" ||
                    run.status === "failed" ||
                    run.status === "canceled",
            ),
        [runs],
    );

    const seriesGroups = useMemo(() => groupChaptersBySeries(cached), [cached]);
    const totalBytes = useMemo(
        () => cached.reduce((sum, entry) => sum + entry.bytes, 0),
        [cached],
    );
    const totalChapters = useMemo(
        () =>
            cached.filter(
                (entry) => entry.state === "ready" || entry.state === "partial",
            ).length,
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
        if (
            !window.confirm(
                `Remove all ${group.chapters.length} cached chapter(s) for "${group.seriesTitle}"?`,
            )
        ) {
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
                    <p className="mt-1 font-display italic text-sm text-text-faint">
                        The drawer &mdash; chapters tucked away for reading without a tether.
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {activeRuns.length > 0 && (
                        <Button
                            variant="danger"
                            onClick={() => cancelAllRuns()}
                            disabled={busy !== null}
                            leading={<XCircle className="h-3.5 w-3.5" />}
                        >
                            Cancel all
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        onClick={() => void handleRefresh()}
                        disabled={busy === "refresh"}
                        leading={<RefreshCw className={cn("h-3.5 w-3.5", busy === "refresh" && "animate-spin")} />}
                    >
                        {busy === "refresh" ? "Refreshing…" : "Refresh"}
                    </Button>
                </div>
            </div>

            {/* Storage summary */}
            <div className="space-y-2 rounded-sm border border-border-subtle bg-surface px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <div className="flex items-center gap-2">
                        <HardDrive className="h-3.5 w-3.5 text-text-faint" />
                        <span className="text-text-muted">
                            <span className="font-mono">{totalChapters}</span>{" "}
                            chapter{totalChapters === 1 ? "" : "s"}{" "}
                            <span className="mx-1 text-text-faint">·</span>
                            <span className="font-mono">{formatBytes(totalBytes)}</span>
                        </span>
                    </div>
                    {storage && storage.quota > 0 && (
                        <span className="text-text-faint">
                            Device storage{" "}
                            <span className="font-mono text-text-muted">
                                {formatBytes(storage.usage)} / {formatBytes(storage.quota)}
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
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">Active</p>
                    {activeRuns.length > 0 && (
                        <span className="rounded-full bg-reading/15 px-2 py-0.5 font-mono text-[10px] font-medium text-reading">
                            {activeRuns.length}
                        </span>
                    )}
                </div>
                {activeRuns.length === 0 ? (
                    <p className="rounded-sm border border-border-subtle bg-surface px-3 py-3 font-display italic text-sm text-text-faint">
                        The drawer is closed.
                    </p>
                ) : (
                    activeRuns.map((run) => (
                        <RunCard
                            key={run.id}
                            data={toRunCardData(run)}
                            actions={{
                                onCancelRun: () => cancelRun(run.id),
                                cancelRunBusy: busy === `cancel-run-${run.id}`,
                            }}
                        />
                    ))
                )}
            </section>

            {/* Cached library */}
            <section className="space-y-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">
                    Cached on this device
                </p>
                {seriesGroups.length === 0 ? (
                    <p className="rounded-sm border border-border-subtle bg-surface px-3 py-6 text-center font-display italic text-sm text-text-faint">
                        Nothing stashed yet. Open a series and tap{" "}
                        <span className="font-sans not-italic text-text-muted">Cache</span>{" "}
                        to keep chapters for the road.
                    </p>
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
                                        <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-text-faint">
                                            <span>
                                                {group.chapters.length} chapter{group.chapters.length === 1 ? "" : "s"}
                                            </span>
                                            <span>·</span>
                                            <span>{formatBytes(group.bytes)}</span>
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
                                    <Button
                                        variant="ghost"
                                        size="xs"
                                        onClick={() => void handleRemoveSeries(group)}
                                        disabled={busy === `remove-series-${group.seriesId}`}
                                        leading={<Trash2 className="h-3 w-3" />}
                                        className="hover:text-dropped"
                                    >
                                        <span className="hidden sm:inline">Remove all</span>
                                    </Button>
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
                                                    <span className="shrink-0 font-mono text-text-faint tabular-nums">
                                                        {formatBytes(chapter.bytes)}
                                                    </span>
                                                    {chapter.state === "partial" && (
                                                        <span className="shrink-0 font-mono text-paused">partial</span>
                                                    )}
                                                    {chapter.state === "pending" && (
                                                        <span className="shrink-0 font-mono text-text-faint">pending</span>
                                                    )}
                                                    {chapter.state === "failed" && (
                                                        <span className="shrink-0 font-mono text-dropped">failed</span>
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
            <RunHistory
                items={historyRuns}
                renderItem={(run) => (
                    <RunCard
                        key={run.id}
                        data={toRunCardData(run)}
                        actions={{
                            onRetry: run.status === "failed" ? () => void retryRun(run.id) : undefined,
                        }}
                    />
                )}
            />
        </div>
    );
}
