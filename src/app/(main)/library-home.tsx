"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Search, SlidersHorizontal, X, RefreshCw } from "lucide-react";
import { MomentumRail, type MomentumItem } from "@/components/momentum-rail";
import { SeriesListItem } from "@/components/series-list-item";
import { SeriesGridCard } from "@/components/series-grid-card";
import { ViewToggle } from "@/components/ui/view-toggle";
import { SelectDropdown } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { LibraryStatus } from "@/lib/library/state";


interface LibraryEntryRecord {
    sourceSeriesId: string;
    title: string;
    coverUrl: string | null;
    status: LibraryStatus;
    addedAt: string | null;
    updatedAt: string | null;
    currentPage: number | null;
    progressUpdatedAt: string | null;
    currentChapterSourceId: string | null;
    currentChapterTitle: string | null;
    totalChapters: number;
    completedChapters: number;
    unreadChapters: number;
    lastCompletedAt: string | null;
    lastCompletedChapterSourceId: string | null;
    lastCompletedChapterTitle: string | null;
    collectionIds: string[];
    tagIds: string[];
}

interface CollectionRecord {
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    createdAt: string | null;
    seriesCount: number;
}

interface TagRecord {
    id: string;
    name: string;
    color: string | null;
    type: string;
    seriesCount: number;
}

type SortMode = "updated" | "added" | "title" | "unread";
type ViewMode = "index" | "grid";

type TabId = "all" | "unread" | "stalled" | string;

const STALLED_DAYS = 14;

const STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: "reading", label: "Reading" },
    { value: "completed", label: "Completed" },
    { value: "paused", label: "Paused" },
    { value: "dropped", label: "Dropped" },
    { value: "rereading", label: "Rereading" },
    { value: "planning", label: "Planning" },
];


export function LibraryHome() {
    const [entries, setEntries] = useState<LibraryEntryRecord[]>([]);
    const [collections, setCollections] = useState<CollectionRecord[]>([]);
    const [tags, setTags] = useState<TagRecord[]>([]);
    const [loading, setLoading] = useState(true);

    const [activeTab, setActiveTab] = useState<TabId>("all");

    const [statusFilter, setStatusFilter] = useState<string>("");
    const [tagFilter, setTagFilter] = useState<string>("");
    const [showFilters, setShowFilters] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const searchInputRef = useRef<HTMLInputElement | null>(null);

    const [sortMode, setSortMode] = useState<SortMode>("updated");
    const [viewMode, setViewMode] = useState<ViewMode>("grid");
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const [libRes, colRes, tagRes] = await Promise.all([
                    fetch("/api/library"),
                    fetch("/api/collections"),
                    fetch("/api/tags"),
                ]);
                const data = libRes.ok ? ((await libRes.json()) as LibraryEntryRecord[]) : [];
                const cols = colRes.ok ? ((await colRes.json()) as CollectionRecord[]) : [];
                const tgs = tagRes.ok ? ((await tagRes.json()) as TagRecord[]) : [];
                if (!cancelled) {
                    setEntries(data);
                    setCollections(cols);
                    setTags(tgs);
                }
            } catch {
                if (!cancelled) {
                    setEntries([]);
                    setCollections([]);
                    setTags([]);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, []);


    async function handleRefreshAll() {
        setRefreshing(true);
        try {
            await fetch("/api/library/refresh", { method: "POST" });
            // Reload library data
            const [libRes, colRes, tagRes] = await Promise.all([
                fetch("/api/library"),
                fetch("/api/collections"),
                fetch("/api/tags"),
            ]);
            if (libRes.ok) setEntries(await libRes.json());
            if (colRes.ok) setCollections(await colRes.json());
            if (tagRes.ok) setTags(await tagRes.json());
        } finally {
            setRefreshing(false);
        }
    }

    const momentumItems: MomentumItem[] = useMemo(
        () =>
            entries
                .filter((e) => e.currentChapterSourceId && e.progressUpdatedAt)
                .sort((a, b) => {
                    const aT = a.progressUpdatedAt ? new Date(a.progressUpdatedAt).getTime() : 0;
                    const bT = b.progressUpdatedAt ? new Date(b.progressUpdatedAt).getTime() : 0;
                    return bT - aT;
                })
                .slice(0, 12)
                .map((e) => ({
                    seriesId: e.sourceSeriesId,
                    chapterId: e.currentChapterSourceId!,
                    title: e.title,
                    coverUrl: e.coverUrl,
                    chapterTitle: e.currentChapterTitle || "Unknown chapter",
                    currentPage: e.currentPage ?? 1,
                    totalChapters: e.totalChapters,
                    completedChapters: e.completedChapters,
                })),
        [entries],
    );

    const unreadCount = useMemo(
        () =>
            entries.filter(
                (e) => e.unreadChapters > 0 && e.status !== "completed" && e.status !== "dropped",
            ).length,
        [entries],
    );

    const stalledCutoff = useMemo(() => Date.now() - STALLED_DAYS * 86400000, []);
    const stalledCount = useMemo(
        () =>
            entries.filter(
                (e) =>
                    (e.status === "reading" || e.status === "rereading") &&
                    e.unreadChapters > 0 &&
                    e.progressUpdatedAt &&
                    new Date(e.progressUpdatedAt).getTime() <= stalledCutoff,
            ).length,
        [entries, stalledCutoff],
    );

    const tabList = useMemo(() => {
        const tabs: Array<{ id: TabId; label: string; count: number }> = [
            { id: "all", label: "All", count: entries.length },
        ];
        if (unreadCount > 0) {
            tabs.push({ id: "unread", label: "Unread", count: unreadCount });
        }
        if (stalledCount > 0) {
            tabs.push({ id: "stalled", label: "Stalled", count: stalledCount });
        }
        for (const col of collections) {
            tabs.push({ id: col.id, label: col.name, count: col.seriesCount });
        }
        return tabs;
    }, [entries.length, unreadCount, stalledCount, collections]);

    const resolvedTab = tabList.some((t) => t.id === activeTab) ? activeTab : "all";

    const hasSecondaryFilters = statusFilter !== "" || tagFilter !== "";

    const filteredEntries = useMemo(() => {
        let result = entries;

        if (resolvedTab === "unread") {
            result = result.filter(
                (e) => e.unreadChapters > 0 && e.status !== "completed" && e.status !== "dropped",
            );
        } else if (resolvedTab === "stalled") {
            result = result.filter(
                (e) =>
                    (e.status === "reading" || e.status === "rereading") &&
                    e.unreadChapters > 0 &&
                    e.progressUpdatedAt &&
                    new Date(e.progressUpdatedAt).getTime() <= stalledCutoff,
            );
        } else if (resolvedTab !== "all") {
            result = result.filter((e) => e.collectionIds.includes(resolvedTab));
        }

        if (statusFilter) {
            result = result.filter((e) => e.status === statusFilter);
        }
        if (tagFilter) {
            result = result.filter((e) => e.tagIds.includes(tagFilter));
        }

        const query = searchQuery.trim().toLowerCase();
        if (query) {
            result = result.filter((entry) =>
                entry.title.toLowerCase().includes(query) ||
                entry.currentChapterTitle?.toLowerCase().includes(query) ||
                entry.lastCompletedChapterTitle?.toLowerCase().includes(query),
            );
        }

        return [...result].sort((a, b) => {
            if (sortMode === "title") return a.title.localeCompare(b.title);
            if (sortMode === "unread")
                return b.unreadChapters - a.unreadChapters || a.title.localeCompare(b.title);
            const aV =
                sortMode === "added"
                    ? (a.addedAt ? new Date(a.addedAt).getTime() : 0)
                    : (a.updatedAt ? new Date(a.updatedAt).getTime() : 0);
            const bV =
                sortMode === "added"
                    ? (b.addedAt ? new Date(b.addedAt).getTime() : 0)
                    : (b.updatedAt ? new Date(b.updatedAt).getTime() : 0);
            return bV - aV;
        });
    }, [entries, resolvedTab, searchQuery, statusFilter, tagFilter, sortMode, stalledCutoff]);

    const clearFilters = useCallback(() => {
        setStatusFilter("");
        setTagFilter("");
        setShowFilters(false);
    }, []);

    useEffect(() => {
        function handleSlashFocus(event: KeyboardEvent) {
            const target = event.target as HTMLElement | null;
            if (
                target &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable)
            ) {
                return;
            }

            if (event.key === "/") {
                event.preventDefault();
                searchInputRef.current?.focus();
            }
        }

        window.addEventListener("keydown", handleSlashFocus);
        return () => window.removeEventListener("keydown", handleSlashFocus);
    }, []);


    const readingCount = useMemo(
        () => entries.filter((e) => e.status === "reading" || e.status === "rereading").length,
        [entries],
    );
    const totalUnread = useMemo(
        () => entries.reduce((sum, e) => sum + e.unreadChapters, 0),
        [entries],
    );


    if (loading) {
        return (
            <div className="space-y-6">
                <div className="flex items-end justify-between">
                    <Skeleton className="h-8 w-28" />
                    <Skeleton className="h-4 w-48" />
                </div>
                <div className="flex gap-3 overflow-hidden">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-[72px] w-60 shrink-0 rounded-sm" />
                    ))}
                </div>
                <Skeleton className="h-9 w-full rounded-sm" />
                {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-sm" />
                ))}
            </div>
        );
    }


    if (entries.length === 0) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
                <div className="space-y-2">
                    <h1 className="font-display text-4xl text-text">Nothing here yet</h1>
                    <p className="max-w-xs text-sm leading-relaxed text-text-muted">
                        Find something to read and add it to your library.
                    </p>
                </div>
                <Link
                    href="/search"
                    className="inline-flex items-center gap-2 rounded-sm bg-accent px-5 py-2.5 text-sm font-medium text-void transition-colors duration-150 hover:bg-accent-muted"
                >
                    <Search className="h-4 w-4" />
                    Search
                </Link>
            </div>
        );
    }


    return (
        <div className="space-y-6">
            <div className="flex items-end justify-between gap-4">
                <div className="flex items-center gap-3">
                    <h1 className="font-display text-3xl leading-none text-text">Library</h1>
                    <button
                        onClick={() => void handleRefreshAll()}
                        disabled={refreshing}
                        className="hidden sm:inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                        title="Refresh all series from source"
                    >
                        <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
                        {refreshing ? "Refreshing…" : "Refresh"}
                    </button>
                </div>
                <p className="hidden sm:block font-mono text-[11px] leading-none text-text-faint">
                    {entries.length} series
                    <span className="mx-1.5 text-border">·</span>
                    {readingCount} reading
                    <span className="mx-1.5 text-border">·</span>
                    {totalUnread} unread
                </p>
            </div>

            {momentumItems.length > 0 && (
                <section>
                    <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.15em] text-text-faint">
                        Pick up where you left off
                    </p>
                    <MomentumRail items={momentumItems} />
                </section>
            )}



            <div className="space-y-3">
                <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                    <div className="flex items-center gap-0.5 border-b border-border-subtle" role="tablist">
                        {tabList.map((tab) => (
                            <button
                                key={tab.id}
                                role="tab"
                                aria-selected={resolvedTab === tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    "relative shrink-0 px-3 pb-2.5 pt-1 text-xs font-medium transition-colors duration-150",
                                    resolvedTab === tab.id
                                        ? "text-text"
                                        : "text-text-faint hover:text-text-muted",
                                )}
                            >
                                {tab.label}
                                <span
                                    className={cn(
                                        "ml-1.5 font-mono text-[10px]",
                                        resolvedTab === tab.id ? "text-accent" : "text-text-faint",
                                    )}
                                >
                                    {tab.count}
                                </span>
                                {resolvedTab === tab.id && (
                                    <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-accent" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[12rem] flex-1">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
                        <input
                            ref={searchInputRef}
                            value={searchQuery}
                            onChange={(event) => setSearchQuery(event.target.value)}
                            placeholder="Search in library…"
                            className="w-full rounded-sm border border-border bg-surface-raised py-2 pl-8 pr-2 text-xs text-text placeholder:text-text-faint transition-colors duration-150 focus:border-accent focus:outline-none"
                        />
                    </div>

                    <SelectDropdown
                        value={sortMode}
                        onChange={(e) => setSortMode(e.target.value as SortMode)}
                        className="w-36 text-xs"
                    >
                        <option value="updated">Recently updated</option>
                        <option value="added">Recently added</option>
                        <option value="title">Title A–Z</option>
                        <option value="unread">Most unread</option>
                    </SelectDropdown>

                    <button
                        type="button"
                        onClick={() => setShowFilters((v) => !v)}
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-2 text-xs transition-colors duration-150",
                            showFilters || hasSecondaryFilters
                                ? "border-accent bg-accent-faint text-accent"
                                : "border-border text-text-muted hover:border-border hover:text-text",
                        )}
                    >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        Filter
                        {hasSecondaryFilters && (
                            <span className="ml-0.5 rounded-full bg-accent px-1.5 py-px text-[10px] font-medium text-void">
                                {(statusFilter ? 1 : 0) + (tagFilter ? 1 : 0)}
                            </span>
                        )}
                    </button>

                    <div className="flex-1" />

                    <ViewToggle view={viewMode} onChange={setViewMode} />
                </div>

                {showFilters && (
                    <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border-subtle bg-surface p-3">
                        <SelectDropdown
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="w-32 text-xs"
                        >
                            <option value="">Any status</option>
                            {STATUS_OPTIONS.map((s) => (
                                <option key={s.value} value={s.value}>
                                    {s.label}
                                </option>
                            ))}
                        </SelectDropdown>

                        {tags.length > 0 && (
                            <SelectDropdown
                                value={tagFilter}
                                onChange={(e) => setTagFilter(e.target.value)}
                                className="w-32 text-xs"
                            >
                                <option value="">Any tag</option>
                                {tags.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.name}
                                    </option>
                                ))}
                            </SelectDropdown>
                        )}

                        {hasSecondaryFilters && (
                            <button
                                type="button"
                                onClick={clearFilters}
                                className="inline-flex items-center gap-1 text-xs text-text-faint transition-colors hover:text-accent"
                            >
                                <X className="h-3 w-3" />
                                Clear
                            </button>
                        )}
                    </div>
                )}
            </div>

            {filteredEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                    <p className="text-sm text-text-faint">
                        {searchQuery.trim()
                            ? "No library series match this search."
                            : hasSecondaryFilters
                                ? "No series match these filters."
                                : resolvedTab !== "all"
                                    ? "This shelf is empty."
                                    : "No series in your library."}
                    </p>
                    {(hasSecondaryFilters || searchQuery.trim()) && (
                        <button
                            type="button"
                            onClick={() => {
                                clearFilters();
                                setSearchQuery("");
                            }}
                            className="text-xs text-accent transition-colors hover:text-accent-muted"
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            ) : viewMode === "index" ? (
                <div className="overflow-hidden rounded-sm border border-border-subtle">
                    {filteredEntries.map((entry) => (
                        <SeriesListItem
                            key={entry.sourceSeriesId}
                            sourceId={entry.sourceSeriesId}
                            title={entry.title}
                            coverUrl={entry.coverUrl}
                            status={entry.status}
                            currentChapterSourceId={entry.currentChapterSourceId}
                            currentChapterTitle={entry.currentChapterTitle}
                            currentPage={entry.currentPage}
                            totalChapters={entry.totalChapters}
                            completedChapters={entry.completedChapters}
                            lastReadAt={entry.progressUpdatedAt}
                        />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                    {filteredEntries.map((entry) => (
                        <SeriesGridCard
                            key={entry.sourceSeriesId}
                            sourceId={entry.sourceSeriesId}
                            title={entry.title}
                            coverUrl={entry.coverUrl}
                            type={entry.status}
                            currentChapterSourceId={entry.currentChapterSourceId}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
