"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useNsfw } from "@/lib/nsfw-context";
import { useOfflineMode } from "@/lib/offline/offline-mode-context";
import { Search, SlidersHorizontal, X, RefreshCw, Check, CloudOff } from "lucide-react";
import { MomentumRail, type MomentumItem } from "@/components/momentum-rail";
import { SeriesListItem } from "@/components/series-list-item";
import { SeriesGridCard } from "@/components/series-grid-card";
import { ViewToggle } from "@/components/ui/view-toggle";
import { SelectDropdown } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button, LinkButton } from "@/components/ui/button";
import type { LibraryStatus } from "@/lib/library/state";


interface LibraryEntryRecord {
    seriesId: string;
    sourceSeriesId: string;
    source: string | null;
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
    downloadedChapters: number;
    lastCompletedAt: string | null;
    lastCompletedChapterSourceId: string | null;
    lastCompletedChapterTitle: string | null;
    latestChapterPublishedAt: number | null;
    tagIds: string[];
    adult: boolean;
}



interface TagRecord {
    id: string;
    name: string;
    color: string | null;
    type: string;
    seriesCount: number;
}

type SortMode =
    | "last-read-desc"
    | "last-read-asc"
    | "unread-desc"
    | "unread-asc"
    | "downloaded-desc"
    | "downloaded-asc"
    | "added-desc"
    | "added-asc";
type ViewMode = "index" | "grid";

type TabId = "all" | "unread" | "stalled" | "caught-up" | string;

const STALLED_DAYS = 14;

const STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: "reading", label: "Reading" },
    { value: "completed", label: "Completed" },
    { value: "paused", label: "Paused" },
    { value: "dropped", label: "Dropped" },
    { value: "rereading", label: "Rereading" },
    { value: "planning", label: "Planning" },
];

const LS_TAB = "library:tab:sfw";
const LS_TAB_NSFW = "library:tab:nsfw";
const LS_SORT = "library:sort";
const LS_VIEW = "library:view";
const LS_STATUS = "library:status-filter";
const LS_TAG = "library:tag-filter";

const VALID_SORTS = new Set<string>([
    "last-read-desc", "last-read-asc", "unread-desc", "unread-asc",
    "downloaded-desc", "downloaded-asc", "added-desc", "added-asc",
]);

// SSR-safe: the server render has no `window`, so return the fallback and
// let a post-mount effect swap in the persisted value. Reading storage from
// inside a useState lazy initializer on a "use client" component produces
// a hydration mismatch because SSR and the first client render disagree.
function readLS(key: string, fallback: string): string {
    if (typeof window === "undefined") return fallback;
    try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

/**
 * Virtual scroll hook — renders only the visible slice of a long list
 * plus an overscan buffer. Uses window scroll and calculates offsets
 * relative to the container element.
 *
 * For grid layouts, callers should divide `items` into rows first
 * and pass `itemHeight` as the row height.
 */
function useVirtualScroll<T>(
    items: T[],
    opts: {
        itemHeight: number;
        overscan?: number;
        containerRef: React.RefObject<HTMLDivElement | null>;
    },
) {
    const [range, setRange] = useState({ start: 0, end: 50 });

    useEffect(() => {
        const container = opts.containerRef.current;
        if (!container) return;

        function update() {
            const scrollTop = window.scrollY;
            const containerTop =
                container!.getBoundingClientRect().top + window.scrollY;
            const relativeScroll = Math.max(0, scrollTop - containerTop);
            const viewportHeight = window.innerHeight;
            const overscan = opts.overscan ?? 5;

            const startRow = Math.max(
                0,
                Math.floor(relativeScroll / opts.itemHeight) - overscan,
            );
            const endRow = Math.min(
                items.length,
                Math.ceil((relativeScroll + viewportHeight) / opts.itemHeight) +
                    overscan,
            );

            setRange((prev) =>
                prev.start === startRow && prev.end === endRow
                    ? prev
                    : { start: startRow, end: endRow },
            );
        }

        update();
        window.addEventListener("scroll", update, { passive: true });
        window.addEventListener("resize", update);
        return () => {
            window.removeEventListener("scroll", update);
            window.removeEventListener("resize", update);
        };
    }, [items.length, opts.itemHeight, opts.overscan, opts.containerRef]);

    const visibleItems = items.slice(range.start, range.end);
    const topPad = range.start * opts.itemHeight;
    const bottomPad = Math.max(0, (items.length - range.end) * opts.itemHeight);

    return { visibleItems, topPad, bottomPad, startIndex: range.start };
}

// Persisted so we can distinguish "brand-new user, empty library" from "user
// with real library, just offline and /api/library wasn't cached before now"
// in the empty-state branch. Flipped to true on first successful library fetch
// with entries; never cleared.
const LS_LIBRARY_EVER_LOADED = "library:ever-loaded";

function readEverLoaded(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return window.localStorage.getItem(LS_LIBRARY_EVER_LOADED) === "1";
    } catch {
        return false;
    }
}

function markEverLoaded(): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(LS_LIBRARY_EVER_LOADED, "1");
    } catch {
        // ignore — transient failure, we'll retry on the next successful load
    }
}

export function LibraryHome() {
    const { nsfwEnabled } = useNsfw();
    const { isOffline } = useOfflineMode();
    const tabStorageKey = nsfwEnabled ? LS_TAB_NSFW : LS_TAB;
    const [entries, setEntries] = useState<LibraryEntryRecord[]>([]);
    const [tags, setTags] = useState<TagRecord[]>([]);
    const [loading, setLoading] = useState(true);
    // Initialize to `false` / "all" so SSR and first client render agree;
    // the useEffect below hydrates the real persisted value after mount.
    const [everLoaded, setEverLoaded] = useState<boolean>(false);
    const everLoadedRef = useRef(everLoaded);
    everLoadedRef.current = everLoaded;

    const [activeTab, setActiveTab] = useState<TabId>("all");

    const [statusFilter, setStatusFilter] = useState<string>("");
    const [tagFilter, setTagFilter] = useState<string>("");
    const [showFilters, setShowFilters] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const searchInputRef = useRef<HTMLInputElement | null>(null);

    const [sortMode, setSortMode] = useState<SortMode>("last-read-desc");
    const [viewMode, setViewMode] = useState<ViewMode>("grid");
    const [refreshing, setRefreshing] = useState(false);
    const [coverRefreshToken, setCoverRefreshToken] = useState<number | null>(null);
    const virtualContainerRef = useRef<HTMLDivElement>(null);

    // ── Bulk selection ────────────────────────────────────────────
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const toggleSelection = useCallback((seriesId: string) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(seriesId)) next.delete(seriesId);
            else next.add(seriesId);
            return next;
        });
    }, []);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
        setSelectionMode(false);
    }, []);

    // Restore persisted filters from localStorage on mount and NSFW mode changes.
    // Also hydrates the ever-loaded sentinel here so initial SSR output doesn't
    // disagree with the client's real state.
    const filtersLoadedRef = useRef(false);
    const loadedTabStorageKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (!filtersLoadedRef.current) {
            const ever = readEverLoaded();
            if (ever) setEverLoaded(true);
        }

        const tab = readLS(tabStorageKey, "all");
        setActiveTab(tab);

        const sort = readLS(LS_SORT, "last-read-desc");
        if (VALID_SORTS.has(sort)) setSortMode(sort as SortMode);

        const view = readLS(LS_VIEW, "grid");
        if (view === "grid" || view === "index") setViewMode(view);

        const status = readLS(LS_STATUS, "");
        setStatusFilter(status);

        const tag = readLS(LS_TAG, "");
        setTagFilter(tag);

        if (status || tag) setShowFilters(true);

        filtersLoadedRef.current = true;
        loadedTabStorageKeyRef.current = tabStorageKey;
    }, [tabStorageKey]);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const nsfwParam = nsfwEnabled ? "?nsfw=1" : "";
                const [libRes, tagRes] = await Promise.all([
                    fetch(`/api/library${nsfwParam}`),
                    fetch("/api/tags"),
                ]);
                const data = libRes.ok ? ((await libRes.json()) as LibraryEntryRecord[]) : [];
                const tgs = tagRes.ok ? ((await tagRes.json()) as TagRecord[]) : [];
                if (!cancelled) {
                    setEntries(data);
                    setTags(tgs);
                    // Only set the "ever loaded" sentinel when the server
                    // actually returned entries — an empty response could be
                    // a real first-time user or a cold cache miss, and we
                    // don't want to promote the latter into "you had stuff
                    // before, trust us."
                    if (libRes.ok && data.length > 0 && !everLoadedRef.current) {
                        markEverLoaded();
                        setEverLoaded(true);
                    }
                }
            } catch {
                if (!cancelled) {
                    setEntries([]);
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
    }, [nsfwEnabled]);


    async function handleRefreshAll() {
        setRefreshing(true);
        try {
            await fetch("/api/library/refresh", { method: "POST" });
            const nsfwParam = nsfwEnabled ? "?nsfw=1" : "";
            const [libRes, tagRes] = await Promise.all([
                fetch(`/api/library${nsfwParam}`),
                fetch("/api/tags"),
            ]);
            if (libRes.ok) setEntries(await libRes.json());
            if (tagRes.ok) setTags(await tagRes.json());
            setCoverRefreshToken(Date.now());
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
                    seriesId: e.seriesId,
                    seriesSource: e.source,
                    chapterId: e.currentChapterSourceId!,
                    title: e.title,
                    coverUrl: `/api/media/cover/${e.seriesId}${coverRefreshToken ? `?v=${coverRefreshToken}` : ""}`,
                    chapterTitle: e.currentChapterTitle || "Unknown chapter",
                    currentPage: e.currentPage ?? 1,
                    totalChapters: e.totalChapters,
                    completedChapters: e.completedChapters,
                    progressUpdatedAt: e.progressUpdatedAt,
                })),
        [coverRefreshToken, entries],
    );

    async function handleDismissContinueReading(seriesId: string) {
        const res = await fetch(`/api/reader/state?seriesId=${encodeURIComponent(seriesId)}`, {
            method: "DELETE",
        });
        if (!res.ok) {
            return;
        }

        setEntries((prev) =>
            prev.map((entry) =>
                entry.seriesId === seriesId
                    ? {
                        ...entry,
                        currentPage: null,
                        progressUpdatedAt: null,
                        currentChapterSourceId: null,
                        currentChapterTitle: null,
                    }
                    : entry,
            ),
        );
    }

    const unreadCount = useMemo(
        () =>
            entries.filter(
                (e) => e.unreadChapters > 0 && e.status !== "completed" && e.status !== "dropped",
            ).length,
        [entries],
    );

    const caughtUpCount = useMemo(
        () =>
            entries.filter(
                (e) =>
                    e.totalChapters > 0 &&
                    e.unreadChapters === 0 &&
                    e.status !== "completed" &&
                    e.status !== "dropped" &&
                    e.status !== "planning",
            ).length,
        [entries],
    );

    // Stabilize the "stalled" cutoff for the session. Previously this
    // was `Date.now() - ...` evaluated during every render, which made
    // every useMemo that depended on it re-compute every render — the
    // `entries` dependency never gates anything because the primitive
    // changes on each invocation. Memoising once per mount is fine:
    // the cutoff only matters to within a day, and the user reloads
    // long before that matters.
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

    const nsfwCount = useMemo(
        () => (nsfwEnabled ? entries.filter((e) => e.adult).length : 0),
        [entries, nsfwEnabled],
    );

    const nonAdultEntries = useMemo(
        () => (nsfwEnabled ? entries.filter((e) => !e.adult) : entries),
        [entries, nsfwEnabled],
    );

    const tabList = useMemo(() => {
        const base = nsfwEnabled ? nonAdultEntries : entries;
        const tabs: Array<{ id: TabId; label: string; count: number }> = [
            { id: "all", label: "All", count: base.length },
        ];
        for (const opt of STATUS_OPTIONS) {
            const count = base.filter((e) => e.status === opt.value).length;
            if (count > 0) {
                tabs.push({ id: opt.value, label: opt.label, count });
            }
        }
        if (unreadCount > 0) {
            tabs.push({ id: "unread", label: "Unread", count: unreadCount });
        }
        if (stalledCount > 0) {
            tabs.push({ id: "stalled", label: "Stalled", count: stalledCount });
        }
        if (caughtUpCount > 0) {
            tabs.push({ id: "caught-up", label: "Caught Up", count: caughtUpCount });
        }
        if (nsfwEnabled && nsfwCount > 0) {
            tabs.push({ id: "nsfw", label: "NSFW", count: nsfwCount });
        }
        return tabs;
    }, [entries, nonAdultEntries, nsfwEnabled, nsfwCount, unreadCount, stalledCount, caughtUpCount]);

    // Persist filter changes to localStorage
    useEffect(() => {
        if (!filtersLoadedRef.current) return;
        if (loadedTabStorageKeyRef.current !== tabStorageKey) return;
        try { window.localStorage.setItem(tabStorageKey, activeTab); } catch { /* */ }
    }, [activeTab, tabStorageKey]);
    useEffect(() => {
        if (!filtersLoadedRef.current) return;
        try { window.localStorage.setItem(LS_SORT, sortMode); } catch { /* */ }
    }, [sortMode]);
    useEffect(() => {
        if (!filtersLoadedRef.current) return;
        try { window.localStorage.setItem(LS_VIEW, viewMode); } catch { /* */ }
    }, [viewMode]);
    useEffect(() => {
        if (!filtersLoadedRef.current) return;
        try { window.localStorage.setItem(LS_STATUS, statusFilter); } catch { /* */ }
    }, [statusFilter]);
    useEffect(() => {
        if (!filtersLoadedRef.current) return;
        try { window.localStorage.setItem(LS_TAG, tagFilter); } catch { /* */ }
    }, [tagFilter]);

    // Clear selection when filters/tab change to avoid acting on invisible items
    useEffect(() => {
        if (selectionMode) setSelectedIds(new Set());
    }, [activeTab, statusFilter, tagFilter, searchQuery, selectionMode]);

    const resolvedTab = tabList.some((t) => t.id === activeTab) ? activeTab : "all";

    const hasSecondaryFilters = statusFilter !== "" || tagFilter !== "";

    const filteredEntries = useMemo(() => {
        let result = entries;

        if (resolvedTab === "nsfw" && nsfwEnabled) {
            result = result.filter((e) => e.adult);
        } else {
            if (nsfwEnabled) {
                result = result.filter((e) => !e.adult);
            }

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
            } else if (resolvedTab === "caught-up") {
                result = result.filter(
                    (e) =>
                        e.totalChapters > 0 &&
                        e.unreadChapters === 0 &&
                        e.status !== "completed" &&
                        e.status !== "dropped" &&
                        e.status !== "planning",
                );
            } else if (
                resolvedTab !== "all" &&
                resolvedTab !== "unread" &&
                resolvedTab !== "stalled" &&
                resolvedTab !== "caught-up"
            ) {
                result = result.filter((e) => e.status === resolvedTab);
            }
        }

        if (resolvedTab !== "nsfw") {
            if (statusFilter) {
                result = result.filter((e) => e.status === statusFilter);
            }
            if (tagFilter) {
                result = result.filter((e) => e.tagIds.includes(tagFilter));
            }
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
            if (sortMode === "unread-desc" || sortMode === "unread-asc") {
                const delta = a.unreadChapters - b.unreadChapters;
                return sortMode === "unread-desc"
                    ? -delta || a.title.localeCompare(b.title)
                    : delta || a.title.localeCompare(b.title);
            }
            if (sortMode === "downloaded-desc" || sortMode === "downloaded-asc") {
                const delta = a.downloadedChapters - b.downloadedChapters;
                return sortMode === "downloaded-desc"
                    ? -delta || a.title.localeCompare(b.title)
                    : delta || a.title.localeCompare(b.title);
            }
            const aV = sortMode === "added-desc" || sortMode === "added-asc"
                ? (a.addedAt ? new Date(a.addedAt).getTime() : 0)
                : (a.progressUpdatedAt ? new Date(a.progressUpdatedAt).getTime() : 0);
            const bV = sortMode === "added-desc" || sortMode === "added-asc"
                ? (b.addedAt ? new Date(b.addedAt).getTime() : 0)
                : (b.progressUpdatedAt ? new Date(b.progressUpdatedAt).getTime() : 0);
            const delta = aV - bV;
            return sortMode === "last-read-asc" || sortMode === "added-asc"
                ? delta || a.title.localeCompare(b.title)
                : -delta || a.title.localeCompare(b.title);
        });
    }, [entries, resolvedTab, searchQuery, statusFilter, tagFilter, sortMode, stalledCutoff, nsfwEnabled]);

    // ── Bulk selection helpers (depend on filteredEntries) ─────────
    const selectAll = useCallback(() => {
        setSelectedIds(new Set(filteredEntries.map((e) => e.seriesId)));
    }, [filteredEntries]);

    async function handleBulkStatusChange(status: string) {
        // allSettled: one failed POST should not cancel the rest of the
        // bulk operation — the server-side writes are independent and
        // partial success is still useful to the user. Re-fetch library
        // afterwards to converge the UI with whichever writes actually
        // landed.
        await Promise.allSettled(
            [...selectedIds].map((id) => {
                const entry = entries.find((e) => e.seriesId === id);
                if (!entry) return Promise.resolve();
                return fetch("/api/library", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        seriesId: entry.sourceSeriesId,
                        status,
                        source: entry.source,
                    }),
                });
            }),
        );
        try {
            const nsfwParam = nsfwEnabled ? "?nsfw=1" : "";
            const res = await fetch(`/api/library${nsfwParam}`);
            if (res.ok) setEntries(await res.json());
        } catch {
            // Network failure on the re-fetch — next render or user
            // refresh will recover. The bulk writes themselves are
            // unaffected.
        }
        clearSelection();
    }

    async function handleBulkRemove() {
        if (!window.confirm(`Remove ${selectedIds.size} series from your library?`)) return;
        const removedIds = new Set<string>();
        // allSettled so one failed DELETE doesn't leave later ones
        // uncalled. The per-item handler swallows its own error and
        // only adds to removedIds on 2xx, so partial success shows
        // correctly in the UI.
        await Promise.allSettled(
            [...selectedIds].map(async (id) => {
                const entry = entries.find((e) => e.seriesId === id);
                if (!entry) return;
                try {
                    const res = await fetch(`/api/library/${encodeURIComponent(entry.sourceSeriesId)}`, {
                        method: "DELETE",
                    });
                    if (res.ok) removedIds.add(id);
                } catch {
                    // Network error on a single row — leave it in the
                    // UI so the user can retry; don't confuse them by
                    // removing the row without confirmation from the
                    // server.
                }
            }),
        );
        if (removedIds.size > 0) {
            setEntries((prev) => prev.filter((e) => !removedIds.has(e.seriesId)));
        }
        clearSelection();
    }

    // ── Virtual scrolling ──────────────────────────────────────────
    const VIRTUAL_THRESHOLD = 50;
    const LIST_ROW_HEIGHT = 56;
    const GRID_ROW_HEIGHT = 220;
    // Use the smallest column count (mobile = 3) so we never skip items
    const GRID_COLS_MIN = 3;

    const useVirtual = filteredEntries.length > VIRTUAL_THRESHOLD;

    // Grid: chunk flat items into rows of GRID_COLS_MIN for virtual scrolling
    const gridRows = useMemo(() => {
        if (!useVirtual || viewMode !== "grid") return [];
        const rows: LibraryEntryRecord[][] = [];
        for (let i = 0; i < filteredEntries.length; i += GRID_COLS_MIN) {
            rows.push(filteredEntries.slice(i, i + GRID_COLS_MIN));
        }
        return rows;
    }, [filteredEntries, useVirtual, viewMode]);

    const gridVirtual = useVirtualScroll(gridRows, {
        itemHeight: GRID_ROW_HEIGHT,
        overscan: 5,
        containerRef: virtualContainerRef,
    });

    const listVirtual = useVirtualScroll(filteredEntries, {
        itemHeight: LIST_ROW_HEIGHT,
        overscan: 10,
        containerRef: virtualContainerRef,
    });

    const clearFilters = useCallback(() => {
        setStatusFilter("");
        setTagFilter("");
        setShowFilters(false);
        try {
            window.localStorage.removeItem(LS_STATUS);
            window.localStorage.removeItem(LS_TAG);
        } catch { /* */ }
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
        // Offline + empty is ambiguous — the library might actually have
        // series, but /api/library wasn't cached before we went offline.
        // Surface that distinction so the user doesn't think their data
        // vanished and so they know what to do about it.
        if (isOffline) {
            // Two distinct situations produce entries.length === 0 offline:
            //   (a) user has used the app before, library genuinely has
            //       content, but /api/library wasn't in API_CACHE (just
            //       evicted under storage pressure, or the user was always
            //       online before v6 shipped).
            //   (b) user is brand new or genuinely has an empty library and
            //       happens to be offline on first open.
            // Phrasing matters: (a) shouldn't panic the user; (b) shouldn't
            // falsely claim data is missing.
            const title = everLoaded ? "Library unavailable offline" : "Library not cached yet";
            const body = everLoaded
                ? "We can't reach the server right now. Your downloaded chapters are still available — reconnect to restore the rest."
                : "Open Tachyon once with an internet connection and your library will be available offline from then on.";
            return (
                <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border-subtle bg-surface-raised">
                        <CloudOff className="h-6 w-6 text-text-muted" />
                    </div>
                    <div className="space-y-2">
                        <h1 className="font-display text-3xl text-text">{title}</h1>
                        <p className="max-w-sm text-sm leading-relaxed text-text-muted">
                            {body}
                        </p>
                    </div>
                    <LinkButton href="/cache" variant="seal" size="md">
                        View downloaded chapters
                    </LinkButton>
                </div>
            );
        }
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
                <div className="space-y-2">
                    <h1 className="font-display text-4xl text-text">An empty shelf</h1>
                    <p className="max-w-xs text-sm leading-relaxed text-text-muted">
                        Find something worth stamping onto it.
                    </p>
                </div>
                <LinkButton
                    href="/search"
                    variant="primary"
                    size="md"
                    leading={<Search className="h-4 w-4" />}
                >
                    Search
                </LinkButton>
            </div>
        );
    }


    return (
        <div className="space-y-6">
            <div className="flex items-baseline justify-between gap-4">
                <h1 className="font-display text-3xl leading-none text-text">Library</h1>
                <p className="font-mono text-[11px] leading-none text-text-faint">
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
                    <MomentumRail items={momentumItems} onRemove={(seriesId) => void handleDismissContinueReading(seriesId)} />
                </section>
            )}



            <div className="space-y-3 overflow-x-clip">
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
                        <option value="last-read-desc">Last read ↓</option>
                        <option value="last-read-asc">Last read ↑</option>
                        <option value="unread-desc">Unread ↓</option>
                        <option value="unread-asc">Unread ↑</option>
                        <option value="downloaded-desc">Downloaded ↓</option>
                        <option value="downloaded-asc">Downloaded ↑</option>
                        <option value="added-desc">Added ↓</option>
                        <option value="added-asc">Added ↑</option>
                    </SelectDropdown>

                    <Button
                        variant="secondary"
                        selected={showFilters || hasSecondaryFilters}
                        onClick={() => setShowFilters((v) => !v)}
                        leading={<SlidersHorizontal className="h-3.5 w-3.5" />}
                        trailing={hasSecondaryFilters ? (
                            <span className="rounded-full bg-accent/20 px-1.5 py-px font-mono text-[10px] font-medium text-accent">
                                {(statusFilter ? 1 : 0) + (tagFilter ? 1 : 0)}
                            </span>
                        ) : undefined}
                    >
                        Filter
                    </Button>

                    <div className="flex-1" />

                    <Button
                        variant="ghost"
                        onClick={() => void handleRefreshAll()}
                        disabled={refreshing}
                        leading={<RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />}
                        title="Refresh all series from source"
                        className="hidden sm:inline-flex"
                    >
                        {refreshing ? "Refreshing…" : "Refresh"}
                    </Button>

                    <Button
                        variant="secondary"
                        selected={selectionMode}
                        onClick={() => {
                            setSelectionMode((v) => !v);
                            if (selectionMode) clearSelection();
                        }}
                    >
                        {selectionMode ? "Done" : "Edit"}
                    </Button>

                    <ViewToggle view={viewMode} onChange={setViewMode} />
                </div>

                {showFilters && resolvedTab !== "nsfw" && (
                    <div className="flex flex-wrap items-center gap-2">
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

            {selectionMode && selectedIds.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-sm border border-accent bg-surface-raised p-3">
                    <span className="font-mono text-xs text-accent">
                        {selectedIds.size} selected
                    </span>
                    <Button variant="ghost" onClick={selectAll}>
                        Select all
                    </Button>
                    <div className="flex-1" />
                    <SelectDropdown
                        value=""
                        onChange={(e) => {
                            if (e.target.value) void handleBulkStatusChange(e.target.value);
                        }}
                        className="w-32 text-xs"
                    >
                        <option value="">Set status…</option>
                        {STATUS_OPTIONS.map((s) => (
                            <option key={s.value} value={s.value}>
                                {s.label}
                            </option>
                        ))}
                    </SelectDropdown>
                    <Button variant="danger" onClick={() => void handleBulkRemove()}>
                        Remove
                    </Button>
                    <Button
                        variant="ghost"
                        onClick={clearSelection}
                        aria-label="Clear selection"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            )}

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
                <div ref={virtualContainerRef} className="overflow-hidden rounded-sm border border-border-subtle">
                    {useVirtual ? (
                        <>
                            <div style={{ height: listVirtual.topPad }} />
                            {listVirtual.visibleItems.map((entry) => (
                                <div key={entry.seriesId} className="relative">
                                    {selectionMode && (
                                        <div
                                            className="absolute inset-0 z-10 cursor-pointer"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                toggleSelection(entry.seriesId);
                                            }}
                                        >
                                            <div
                                                className={cn(
                                                    "absolute left-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors",
                                                    selectedIds.has(entry.seriesId)
                                                        ? "border-accent bg-accent"
                                                        : "border-text-faint bg-void/50",
                                                )}
                                            >
                                                {selectedIds.has(entry.seriesId) && (
                                                    <Check className="h-3 w-3 text-void" />
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    <SeriesListItem
                                        sourceId={entry.seriesId}
                                        source={entry.source}
                                        title={entry.title}
                                        coverUrl={`/api/media/cover/${entry.seriesId}${coverRefreshToken ? `?v=${coverRefreshToken}` : ""}`}
                                        status={entry.status}
                                        currentChapterSourceId={entry.currentChapterSourceId}
                                        currentChapterTitle={entry.currentChapterTitle}
                                        currentPage={entry.currentPage}
                                        totalChapters={entry.totalChapters}
                                        completedChapters={entry.completedChapters}
                                        unreadChapters={entry.unreadChapters}
                                        lastReadAt={entry.progressUpdatedAt}
                                        latestChapterPublishedAt={entry.latestChapterPublishedAt}
                                    />
                                </div>
                            ))}
                            <div style={{ height: listVirtual.bottomPad }} />
                        </>
                    ) : (
                        filteredEntries.map((entry) => (
                            <div key={entry.seriesId} className="relative">
                                {selectionMode && (
                                    <div
                                        className="absolute inset-0 z-10 cursor-pointer"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            toggleSelection(entry.seriesId);
                                        }}
                                    >
                                        <div
                                            className={cn(
                                                "absolute left-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors",
                                                selectedIds.has(entry.seriesId)
                                                    ? "border-accent bg-accent"
                                                    : "border-text-faint bg-void/50",
                                            )}
                                        >
                                            {selectedIds.has(entry.seriesId) && (
                                                <Check className="h-3 w-3 text-void" />
                                            )}
                                        </div>
                                    </div>
                                )}
                                <SeriesListItem
                                    sourceId={entry.seriesId}
                                    source={entry.source}
                                    title={entry.title}
                                    coverUrl={`/api/media/cover/${entry.seriesId}${coverRefreshToken ? `?v=${coverRefreshToken}` : ""}`}
                                    status={entry.status}
                                    currentChapterSourceId={entry.currentChapterSourceId}
                                    currentChapterTitle={entry.currentChapterTitle}
                                    currentPage={entry.currentPage}
                                    totalChapters={entry.totalChapters}
                                    completedChapters={entry.completedChapters}
                                    unreadChapters={entry.unreadChapters}
                                    lastReadAt={entry.progressUpdatedAt}
                                    latestChapterPublishedAt={entry.latestChapterPublishedAt}
                                />
                            </div>
                        ))
                    )}
                </div>
            ) : (
                <div ref={virtualContainerRef}>
                    {useVirtual ? (
                        <>
                            <div style={{ height: gridVirtual.topPad }} />
                            <div className="grid grid-cols-3 gap-2.5 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                                {gridVirtual.visibleItems.flatMap((row) =>
                                    row.map((entry) => (
                                        <div key={entry.seriesId} className="relative">
                                            {selectionMode && (
                                                <div
                                                    className="absolute inset-0 z-10 cursor-pointer"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        toggleSelection(entry.seriesId);
                                                    }}
                                                >
                                                    <div
                                                        className={cn(
                                                            "absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors",
                                                            selectedIds.has(entry.seriesId)
                                                                ? "border-accent bg-accent"
                                                                : "border-white/70 bg-void/50",
                                                        )}
                                                    >
                                                        {selectedIds.has(entry.seriesId) && (
                                                            <Check className="h-3 w-3 text-void" />
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                            <SeriesGridCard
                                                sourceId={entry.seriesId}
                                                source={entry.source}
                                                showSource={false}
                                                title={entry.title}
                                                coverUrl={`/api/media/cover/${entry.seriesId}${coverRefreshToken ? `?v=${coverRefreshToken}` : ""}`}
                                                status={entry.status}
                                                currentChapterSourceId={entry.currentChapterSourceId}
                                                unreadChapters={entry.unreadChapters}
                                                totalChapters={entry.totalChapters}
                                                completedChapters={entry.completedChapters}
                                                latestChapterPublishedAt={entry.latestChapterPublishedAt}
                                            />
                                        </div>
                                    )),
                                )}
                            </div>
                            <div style={{ height: gridVirtual.bottomPad }} />
                        </>
                    ) : (
                        <div className="grid grid-cols-3 gap-2.5 sm:gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                            {filteredEntries.map((entry) => (
                                <div key={entry.seriesId} className="relative">
                                    {selectionMode && (
                                        <div
                                            className="absolute inset-0 z-10 cursor-pointer"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                toggleSelection(entry.seriesId);
                                            }}
                                        >
                                            <div
                                                className={cn(
                                                    "absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors",
                                                    selectedIds.has(entry.seriesId)
                                                        ? "border-accent bg-accent"
                                                        : "border-white/70 bg-void/50",
                                                )}
                                            >
                                                {selectedIds.has(entry.seriesId) && (
                                                    <Check className="h-3 w-3 text-void" />
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    <SeriesGridCard
                                        sourceId={entry.seriesId}
                                        source={entry.source}
                                        title={entry.title}
                                        coverUrl={`/api/media/cover/${entry.seriesId}${coverRefreshToken ? `?v=${coverRefreshToken}` : ""}`}
                                        type={entry.status}
                                        status={entry.status}
                                        currentChapterSourceId={entry.currentChapterSourceId}
                                        unreadChapters={entry.unreadChapters}
                                        totalChapters={entry.totalChapters}
                                        completedChapters={entry.completedChapters}
                                        latestChapterPublishedAt={entry.latestChapterPublishedAt}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
