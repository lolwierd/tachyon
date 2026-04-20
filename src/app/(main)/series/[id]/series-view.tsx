"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  Download,
  HardDrive,
  HardDriveDownload,
  RefreshCw,
  Eye,
  EyeOff,
  Trash2,
  Check,
} from "lucide-react";
import { Cover } from "@/components/ui/cover";
import { SelectDropdown } from "@/components/ui/select";
import { Button, LinkButton } from "@/components/ui/button";
import { ChapterListItem } from "@/components/chapter-list-item";
import {
  LAMP_TEXT_CLASS,
  formatAbsolute,
  formatUpdatedPhrase,
  lampFromPublishedAt,
} from "@/lib/ui/freshness";
import { JumpToChapter } from "@/components/ui/jump-to-chapter";
import { useNsfw } from "@/lib/nsfw-context";
import { buildReaderHref, buildSeriesApiPath } from "@/lib/reader/url";
import { cn, formatBytes } from "@/lib/utils";
import type { SeriesDetail } from "@/lib/sources/types";
import {
  getBulkDownloadTargetChapterIds,
  getReadDownloadedChapterIds,
  type DownloadScope,
} from "./offline-actions";
import {
  getBulkCacheTargetChapterIds,
  getReadCachedChapterIds,
  type CacheScope,
} from "@/lib/offline/cache-actions";
import { getCachedChapterIdsForSeries } from "@/lib/offline/device-cache";
import { enqueueCacheRun, useCacheQueue } from "@/lib/offline/cache-queue";

type LibraryStatus = "reading" | "completed" | "paused" | "dropped" | "rereading" | "planning";
type SeriesViewData = SeriesDetail & { source?: string | null; seriesId?: string };


interface TagRecord {
  id: string;
  name: string;
  color: string | null;
  type: string;
}

interface ReaderProgressInfo {
  currentChapterId: string | null;
  currentPage: number;
}

interface ChapterWithProgress {
  sourceChapterId: string;
  chapterNo: number;
  title: string;
  readState: "read" | "unread" | "in-progress";
  lastPage: number;
  publishedAt?: number | null;
}

interface OfflineOverview {
  storage: {
    cacheBytes: number;
    cachedFiles: number;
    pinnedBytes: number;
    pinnedChapters: number;
  };
  chapters: Array<{
    sourceChapterId: string;
    pinned: boolean;
    state: "missing" | "partial" | "ready";
  }>;
}

type ChapterFilter = "all" | "unread" | "read" | "in-progress" | "downloaded";

const STATUS_OPTIONS: Array<{ value: LibraryStatus; label: string }> = [
  { value: "reading", label: "Reading" },
  { value: "planning", label: "Planning" },
  { value: "completed", label: "Completed" },
  { value: "paused", label: "Paused" },
  { value: "rereading", label: "Rereading" },
  { value: "dropped", label: "Dropped" },
];

const DOWNLOAD_OPTIONS: Array<{ value: DownloadScope; label: string }> = [
  { value: "unread", label: "Download unread" },
  { value: "all", label: "Download all" },
  { value: "next5", label: "Download next 5" },
  { value: "next10", label: "Download next 10" },
  { value: "next50", label: "Download next 50" },
  { value: "next100", label: "Download next 100" },
];

const CACHE_OPTIONS: Array<{ value: CacheScope; label: string }> = [
  { value: "unread", label: "Cache unread" },
  { value: "all", label: "Cache all" },
  { value: "next5", label: "Cache next 5" },
  { value: "next10", label: "Cache next 10" },
  { value: "next50", label: "Cache next 50" },
  { value: "next100", label: "Cache next 100" },
];
const MARK_READ_BATCH_SIZE = 500;

function chunkIds(ids: string[], size: number) {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

async function getApiErrorMessage(response: Response, fallback: string) {
  try {
    const body = await response.json() as {
      error?: string;
      details?: Array<{ message?: string }>;
    };
    const detailMessage = body.details?.find((detail) => typeof detail.message === "string")?.message?.trim();
    if (detailMessage) {
      return detailMessage;
    }

    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    // Ignore invalid JSON error bodies and use the fallback.
  }

  return fallback;
}

export function SeriesView({
  sourceId,
  sourceName = null,
}: {
  sourceId: string;
  sourceName?: string | null;
}) {
  const { nsfwEnabled } = useNsfw();
  const [series, setSeries] = useState<SeriesViewData | null>(null);
  const [chapters, setChapters] = useState<ChapterWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [chaptersLoading, setChaptersLoading] = useState(true);
  const [descExpanded, setDescExpanded] = useState(false);
  const [chaptersReversed, setChaptersReversed] = useState(false);
  const sortStorageKey = `series:${sourceId}:sort-reversed`;

  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus>("planning");
  const [libraryEntryStatus, setLibraryEntryStatus] = useState<LibraryStatus | null>(null);
  const [librarySaving, setLibrarySaving] = useState(false);

  const [tags, setTags] = useState<TagRecord[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const [seriesProgress, setSeriesProgress] = useState<ReaderProgressInfo | null>(null);

  const [offline, setOffline] = useState<OfflineOverview | null>(null);
  const [offlineBusyId, setOfflineBusyId] = useState<string | null>(null);
  const [downloadingChapterIds, setDownloadingChapterIds] = useState<string[]>([]);
  // Chapter IDs actively being downloaded by the background worker
  const [workerRunningIds, setWorkerRunningIds] = useState<Set<string>>(new Set());
  const [workerQueuedIds, setWorkerQueuedIds] = useState<Set<string>>(new Set());
  const [autoDownloadNewEnabled, setAutoDownloadNewEnabled] = useState(false);
  const [autoDownloadNewLimit, setAutoDownloadNewLimit] = useState(3);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyStatus, setPolicyStatus] = useState<string | null>(null);

  const chapterListRef = useRef<HTMLDivElement>(null);
  const chapterFilterLoadedRef = useRef(false);
  const [jumpTarget, setJumpTarget] = useState<number | null>(null);
  const [chapterFilter, setChapterFilter] = useState<ChapterFilter>("unread");
  const chapterFilterStorageKey = `series:${sourceId}:chapter-filter`;
  const [coverRefreshToken, setCoverRefreshToken] = useState(0);

  const policyLoadedRef = useRef(false);
  const autoDownloadEnabledRef = useRef(false);
  const autoDownloadLimitRef = useRef(3);

  const [refreshing, setRefreshing] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [showCacheMenu, setShowCacheMenu] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  const cacheMenuRef = useRef<HTMLDivElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const [cachedChapterIds, setCachedChapterIds] = useState<Set<string>>(new Set());
  const [cacheBusy, setCacheBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const cacheQueue = useCacheQueue();

  // Central bookkeeping for "fire and forget" timeouts that flip a piece of
  // UI state back to null after a few seconds (toasts, "Saved" pills, etc).
  // Without this, setState would fire on an unmounted component when the
  // user leaves the series page during the timer's lifetime.
  const transientTimersRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const timers = transientTimersRef.current;
    return () => {
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
    };
  }, []);
  const scheduleTransient = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      transientTimersRef.current.delete(id);
      fn();
    }, ms);
    transientTimersRef.current.add(id);
  }, []);

  function showToast(message: string) {
    setToast(message);
    scheduleTransient(() => setToast(null), 3_500);
  }

  // Close dropdown menus when clicking outside
  useEffect(() => {
    if (!showDownloadMenu && !showCacheMenu && !showStatusMenu) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (showDownloadMenu && downloadMenuRef.current && !downloadMenuRef.current.contains(target)) {
        setShowDownloadMenu(false);
      }
      if (showCacheMenu && cacheMenuRef.current && !cacheMenuRef.current.contains(target)) {
        setShowCacheMenu(false);
      }
      if (showStatusMenu && statusMenuRef.current && !statusMenuRef.current.contains(target)) {
        setShowStatusMenu(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setShowDownloadMenu(false);
      setShowCacheMenu(false);
      setShowStatusMenu(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showDownloadMenu, showCacheMenu, showStatusMenu]);

  const buildChaptersApiPath = useCallback((refresh = false) => {
    const params = new URLSearchParams();
    if (sourceName) {
      params.set("source", sourceName);
    }
    if (refresh) {
      params.set("refresh", "true");
    }

    const query = params.toString();
    return query ? `/api/series/${sourceId}/chapters?${query}` : `/api/series/${sourceId}/chapters`;
  }, [sourceId, sourceName]);

  const buildLibraryApiPath = useCallback((id: string, preferredSource?: string | null) => {
    const params = new URLSearchParams();
    const source = preferredSource ?? sourceName ?? series?.source ?? null;
    if (source) {
      params.set("source", source);
    }

    const query = params.toString();
    return query ? `/api/library/${id}?${query}` : `/api/library/${id}`;
  }, [sourceName, series?.source]);

  // ── data loading ──────────────────────────────────────────────────

  async function refreshOffline() {
    const res = await fetch(`/api/offline?seriesId=${sourceId}`);
    if (res.ok) setOffline((await res.json()) as OfflineOverview);
  }

  const refreshCached = useCallback(async () => {
    try {
      const ids = await getCachedChapterIdsForSeries(sourceId);
      setCachedChapterIds(ids);
    } catch {
      // IDB unavailable — leave state as-is
    }
  }, [sourceId]);

  // Re-read the device cache whenever a cache run transitions to a terminal
  // state so the chapter badges stay in sync with what's actually on disk.
  const cacheTerminalSignature = cacheQueue.runs
    .filter((run) =>
      run.tasks.some(
        (task) => task.seriesId === sourceId && (
          task.state === "succeeded" ||
          task.state === "failed" ||
          task.state === "canceled"
        ),
      ),
    )
    .map((run) => `${run.id}:${run.updatedAt}`)
    .join("|");
  useEffect(() => {
    void refreshCached();
  }, [cacheTerminalSignature, refreshCached]);

  const refreshWorkerDownloads = useCallback(async () => {
    const res = await fetch(`/api/downloads/runs?seriesId=${sourceId}&includeTasks=true&limit=10`);
    if (!res.ok) return;
    const body = (await res.json()) as {
      runs: Array<{
        status: string;
        tasks: Array<{ sourceChapterId: string | null; state: string }>;
      }>;
    };
    const running = new Set<string>();
    const queued = new Set<string>();
    for (const run of body.runs) {
      if (run.status !== "queued" && run.status !== "running" && run.status !== "canceling") continue;
      for (const task of run.tasks) {
        if (!task.sourceChapterId) continue;
        if (task.state === "running") running.add(task.sourceChapterId);
        else if (task.state === "queued" || task.state === "retry_wait") queued.add(task.sourceChapterId);
      }
    }
    setWorkerRunningIds(running);
    setWorkerQueuedIds(queued);
  }, [sourceId]);

  // Poll worker download state every 4s. refreshWorkerDownloads is async
  // so its rejections would become unhandled; swallow per-tick failures
  // since a transient network blip shouldn't crash the page or spam the
  // console. The next tick will try again.
  useEffect(() => {
    refreshWorkerDownloads().catch(() => {});
    const id = window.setInterval(() => {
      refreshWorkerDownloads().catch(() => {});
    }, 4_000);
    return () => window.clearInterval(id);
  }, [refreshWorkerDownloads]);

  useEffect(() => {
    async function load() {
      try {
        const seriesApiPath = buildSeriesApiPath(sourceId, sourceName);
        const chaptersApiPath = buildChaptersApiPath();
        const [seriesRes, chaptersRes, tagsRes, seriesTagsRes, offlineRes, policyRes] =
          await Promise.all([
            fetch(seriesApiPath),
            fetch(chaptersApiPath),
            fetch("/api/tags"),
            fetch(`/api/tags/series/${sourceId}`),
            fetch(`/api/offline?seriesId=${sourceId}`),
            fetch(`/api/downloads/policy/${sourceId}`),
          ]);

        let nextSeries: SeriesViewData | null = null;
        if (seriesRes.ok) {
          nextSeries = (await seriesRes.json()) as SeriesViewData;
          setSeries(nextSeries);
        }
        setLoading(false);

        if (chaptersRes.ok) setChapters((await chaptersRes.json()) as ChapterWithProgress[]);
        setChaptersLoading(false);

        const libraryRes = await fetch(
          buildLibraryApiPath(nextSeries?.seriesId ?? sourceId, nextSeries?.source ?? null),
        );
        if (libraryRes.ok) {
          const entry = (await libraryRes.json()) as {
            status: LibraryStatus;
            currentChapterSourceId: string | null;
            currentPage: number | null;
          };
          setLibraryEntryStatus(entry.status);
          setLibraryStatus(entry.status);
          if (entry.currentChapterSourceId) {
            setSeriesProgress({
              currentChapterId: entry.currentChapterSourceId,
              currentPage: entry.currentPage ?? 0,
            });
          }
        }

        if (tagsRes.ok) setTags(await tagsRes.json());
        if (seriesTagsRes.ok) {
          setSelectedTagIds(((await seriesTagsRes.json()) as { tagIds: string[] }).tagIds);
        }
        if (offlineRes.ok) setOffline((await offlineRes.json()) as OfflineOverview);
        if (policyRes.ok) {
          const policy = (await policyRes.json()) as {
            autoDownloadNewEnabled?: boolean;
            autoDownloadNewLimit?: number;
          };
          setAutoDownloadNewEnabled(Boolean(policy.autoDownloadNewEnabled));
          setAutoDownloadNewLimit(
            Math.min(Math.max(Math.trunc(policy.autoDownloadNewLimit ?? 3), 1), 50),
          );
          policyLoadedRef.current = true;
        }
      } catch {
        setLoading(false);
        setChaptersLoading(false);
      }
    }
    void load();
  }, [sourceId, sourceName, buildChaptersApiPath, buildLibraryApiPath]);

  useEffect(() => {
    const savedFilter = window.localStorage.getItem(chapterFilterStorageKey);
    if (
      savedFilter === "all" ||
      savedFilter === "unread" ||
      savedFilter === "read" ||
      savedFilter === "in-progress" ||
      savedFilter === "downloaded"
    ) {
      setChapterFilter(savedFilter);
    } else {
      setChapterFilter("unread");
    }
    chapterFilterLoadedRef.current = true;
  }, [chapterFilterStorageKey]);

  useEffect(() => {
    if (!chapterFilterLoadedRef.current) return;
    window.localStorage.setItem(chapterFilterStorageKey, chapterFilter);
  }, [chapterFilter, chapterFilterStorageKey]);

  // Load/save sort order per series
  const sortLoadedRef = useRef(false);
  useEffect(() => {
    const saved = window.localStorage.getItem(sortStorageKey);
    if (saved === "1") setChaptersReversed(true);
    sortLoadedRef.current = true;
  }, [sortStorageKey]);

  useEffect(() => {
    if (!sortLoadedRef.current) return;
    window.localStorage.setItem(sortStorageKey, chaptersReversed ? "1" : "0");
  }, [chaptersReversed, sortStorageKey]);

  // ── handlers ──────────────────────────────────────────────────────

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const seriesApiPath = buildSeriesApiPath(sourceId, sourceName);
      const [seriesRes, chaptersRes] = await Promise.all([
        fetch(sourceName ? `${seriesApiPath}&refresh=true` : `${seriesApiPath}?refresh=true`),
        fetch(buildChaptersApiPath(true)),
      ]);
      if (seriesRes.ok) setSeries(await seriesRes.json());
      if (chaptersRes.ok) setChapters((await chaptersRes.json()) as ChapterWithProgress[]);
      setCoverRefreshToken(Date.now());
    } finally {
      setRefreshing(false);
    }
  }

  async function handleLibrarySave(status?: LibraryStatus) {
    if (!series) return;
    const targetStatus = status ?? libraryStatus;
    // Snapshot the previous state so we can roll back if the server
    // rejects the change or the network dies mid-request. Without this,
    // a failed save leaves the UI showing a status that the server
    // never accepted.
    const previousStatus = libraryStatus;
    const previousEntry = libraryEntryStatus;
    setLibrarySaving(true);
    setLibraryStatus(targetStatus);
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seriesId: sourceId,
          status: targetStatus,
          source: sourceName ?? series.source ?? undefined,
          series,
          chapters,
        }),
      });
      if (!res.ok) {
        setLibraryStatus(previousStatus);
        setLibraryEntryStatus(previousEntry);
        showToast("Couldn't save — check connection");
        return;
      }
      const entry = (await res.json()) as { status?: LibraryStatus } | null;
      const resolvedStatus = entry?.status ?? targetStatus;
      setLibraryEntryStatus(resolvedStatus);
      setLibraryStatus(resolvedStatus);
    } catch {
      setLibraryStatus(previousStatus);
      setLibraryEntryStatus(previousEntry);
      showToast("Couldn't save — check connection");
    } finally {
      setLibrarySaving(false);
    }
  }

  async function handleRemoveFromLibrary() {
    if (!window.confirm("Remove this series from your library?")) return;
    try {
      const res = await fetch(buildLibraryApiPath(localSeriesId), { method: "DELETE" });
      if (res.ok) {
        setLibraryEntryStatus(null);
        setSelectedTagIds([]);
      } else {
        showToast("Couldn't remove — try again");
      }
    } catch {
      showToast("Couldn't remove — check connection");
    }
  }

  async function handleAdultToggle(nextAdult: boolean) {
    if (!libraryEntryStatus) return;

    try {
      const res = await fetch(buildLibraryApiPath(localSeriesId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adult: nextAdult, nsfwEnabled }),
      });
      if (!res.ok) {
        showToast("Couldn't update — try again");
        return;
      }

      const entry = await res.json() as { adult: boolean };
      setSeries((prev) => (prev ? { ...prev, isAdult: entry.adult } : prev));
      showToast(entry.adult ? "Moved to NSFW" : "Moved to main library");
    } catch {
      showToast("Couldn't update — check connection");
    }
  }

  async function handleTagToggle(tagId: string, checked: boolean) {
    if (!series) return;
    // Snapshot previous tags so a failed PUT doesn't leave the UI showing
    // a tag set the server never accepted.
    const previousTagIds = selectedTagIds;
    const next = checked
      ? [...new Set([...selectedTagIds, tagId])]
      : selectedTagIds.filter((id) => id !== tagId);
    setSelectedTagIds(next);
    try {
      const res = await fetch(`/api/tags/series/${sourceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagIds: next, series }),
      });
      if (!res.ok) {
        setSelectedTagIds(previousTagIds);
        showToast("Couldn't update tags — try again");
        return;
      }
      setSelectedTagIds(((await res.json()) as { tagIds: string[] }).tagIds);
    } catch {
      setSelectedTagIds(previousTagIds);
      showToast("Couldn't update tags — check connection");
    }
  }

  async function handleBulkDownload(scope: DownloadScope) {
    const targetIds = getBulkDownloadTargetChapterIds(chapters, downloadedChapterIds, scope);
    setDownloadingChapterIds(targetIds);
    setOfflineBusyId("__bulk");
    setShowDownloadMenu(false);
    try {
      const res = await fetch("/api/offline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "downloadBulk", seriesId: sourceId, scope }),
      });
      if (res.ok) {
        const n = targetIds.length;
        if (n > 0) showToast(`Queued ${n} chapter${n !== 1 ? "s" : ""}`);
        await refreshOffline();
      }
    } finally {
      setDownloadingChapterIds([]);
      setOfflineBusyId(null);
    }
  }

  async function handleToggleChapterDownload(chapterSourceId: string, downloaded: boolean) {
    setDownloadingChapterIds(downloaded ? [] : [chapterSourceId]);
    setOfflineBusyId(chapterSourceId);
    try {
      const res = await fetch("/api/offline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: downloaded ? "unpinChapter" : "pinChapter",
          seriesId: sourceId,
          chapterId: chapterSourceId,
        }),
      });
      if (res.ok) await refreshOffline();
    } finally {
      setDownloadingChapterIds([]);
      setOfflineBusyId(null);
    }
  }

  async function handleDeleteReadChapters() {
    setOfflineBusyId("__delete-read");
    try {
      const res = await fetch("/api/offline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteReadChapters", seriesId: sourceId, keepLastN: 0 }),
      });
      if (res.ok) await refreshOffline();
    } finally {
      setOfflineBusyId(null);
    }
  }

  async function handleBulkCache(scope: CacheScope) {
    if (!series) return;
    const targetIds = getBulkCacheTargetChapterIds(chapters, cachedChapterIds, scope);
    if (targetIds.length === 0) {
      showToast("Nothing to cache");
      setShowCacheMenu(false);
      return;
    }
    const selectedChapters = targetIds
      .map((id) => chapters.find((chapter) => chapter.sourceChapterId === id))
      .filter((chapter): chapter is ChapterWithProgress => Boolean(chapter));
    setCacheBusy("__bulk");
    setShowCacheMenu(false);
    try {
      enqueueCacheRun({
        trigger: "manual",
        scope: { sourceSeriesId: sourceId, reason: `bulk:${scope}` },
        tasks: selectedChapters.map((chapter) => ({
          seriesId: sourceId,
          sourceName: sourceName ?? series.source ?? null,
          chapterId: chapter.sourceChapterId,
          chapterNo: chapter.chapterNo,
          chapterTitle: chapter.title,
          seriesTitle: series.title,
          seriesCoverUrl: series.coverUrl ?? null,
        })),
      });
      showToast(`Caching ${selectedChapters.length} chapter${selectedChapters.length !== 1 ? "s" : ""}`);
    } finally {
      setCacheBusy(null);
    }
  }

  async function handleToggleChapterCache(chapterSourceId: string, cached: boolean) {
    if (!series) return;
    const chapter = chapters.find((candidate) => candidate.sourceChapterId === chapterSourceId);
    if (!chapter) return;
    setCacheBusy(chapterSourceId);
    try {
      if (cached) {
        enqueueCacheRun({
          trigger: "manual",
          kind: "delete",
          scope: { sourceSeriesId: sourceId, reason: "single" },
          tasks: [
            {
              seriesId: sourceId,
              sourceName: sourceName ?? series.source ?? null,
              chapterId: chapter.sourceChapterId,
              chapterNo: chapter.chapterNo,
              chapterTitle: chapter.title,
              seriesTitle: series.title,
              seriesCoverUrl: series.coverUrl ?? null,
            },
          ],
        });
      } else {
        enqueueCacheRun({
          trigger: "manual",
          scope: { sourceSeriesId: sourceId, reason: "single" },
          tasks: [
            {
              seriesId: sourceId,
              sourceName: sourceName ?? series.source ?? null,
              chapterId: chapter.sourceChapterId,
              chapterNo: chapter.chapterNo,
              chapterTitle: chapter.title,
              seriesTitle: series.title,
              seriesCoverUrl: series.coverUrl ?? null,
            },
          ],
        });
      }
    } finally {
      setCacheBusy(null);
    }
  }

  async function handleDeleteReadCachedChapters() {
    if (!series) return;
    const readCachedIds = getReadCachedChapterIds(chapters, cachedChapterIds);
    if (readCachedIds.length === 0) {
      showToast("No read chapters cached");
      return;
    }
    const selectedChapters = readCachedIds
      .map((id) => chapters.find((candidate) => candidate.sourceChapterId === id))
      .filter((chapter): chapter is ChapterWithProgress => Boolean(chapter));
    setCacheBusy("__delete-read");
    try {
      enqueueCacheRun({
        trigger: "manual",
        kind: "delete",
        scope: { sourceSeriesId: sourceId, reason: "deleteReadCached" },
        tasks: selectedChapters.map((chapter) => ({
          seriesId: sourceId,
          sourceName: sourceName ?? series.source ?? null,
          chapterId: chapter.sourceChapterId,
          chapterNo: chapter.chapterNo,
          chapterTitle: chapter.title,
          seriesTitle: series.title,
          seriesCoverUrl: series.coverUrl ?? null,
        })),
      });
      showToast(`Removing ${selectedChapters.length} cached chapter${selectedChapters.length !== 1 ? "s" : ""}`);
    } finally {
      setCacheBusy(null);
    }
  }

  // Keep refs in sync so the save callback doesn't need them as deps
  useEffect(() => { autoDownloadEnabledRef.current = autoDownloadNewEnabled; }, [autoDownloadNewEnabled]);
  useEffect(() => { autoDownloadLimitRef.current = autoDownloadNewLimit; }, [autoDownloadNewLimit]);

  const handleSaveSeriesDownloadPolicy = useCallback(async () => {
    const enabled = autoDownloadEnabledRef.current;
    const limit = Math.min(Math.max(Math.trunc(autoDownloadLimitRef.current), 1), 50);
    setPolicySaving(true);
    setPolicyStatus(null);
    try {
      const res = await fetch(`/api/downloads/policy/${sourceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoDownloadNewEnabled: enabled, autoDownloadNewLimit: limit }),
      });

      // No "Saved" confirmation on success. The switch position is the
      // confirmation — a green "Saved" hanging around for 2s is visual
      // noise that causes layout shift for a result the user already
      // sees. Errors are still surfaced below.
      if (!res.ok) {
        setPolicyStatus("Failed to save");
      }
    } finally {
      setPolicySaving(false);
    }
  }, [sourceId]);

  // Auto-save policy when toggle or limit changes (debounced 800ms)
  useEffect(() => {
    if (!policyLoadedRef.current) return;
    const timer = setTimeout(() => void handleSaveSeriesDownloadPolicy(), 800);
    return () => clearTimeout(timer);
  }, [autoDownloadNewEnabled, autoDownloadNewLimit, handleSaveSeriesDownloadPolicy]);

  async function handleMarkRead(chapterSourceIds: string[], read: boolean) {
    const uniqueIds = [...new Set(chapterSourceIds)];
    const targetIds = uniqueIds.filter((id) => {
      const chapter = chapters.find((ch) => ch.sourceChapterId === id);
      if (!chapter) return false;
      return read ? chapter.readState !== "read" : chapter.readState !== "unread";
    });

    if (targetIds.length === 0) {
      return;
    }

    const batches = chunkIds(targetIds, MARK_READ_BATCH_SIZE);
    const appliedIds = new Set<string>();

    try {
      for (const batch of batches) {
        const res = await fetch(`${buildSeriesApiPath(sourceId)}/mark-read`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chapterIds: batch, read }),
        });

        if (!res.ok) {
          showToast(await getApiErrorMessage(
            res,
            read ? "Failed to mark chapters as read" : "Failed to mark chapters as unread",
          ));
          break;
        }

        for (const id of batch) {
          appliedIds.add(id);
        }
      }
    } catch {
      showToast(read ? "Failed to mark chapters as read" : "Failed to mark chapters as unread");
    }

    if (appliedIds.size > 0) {
      setChapters((prev) =>
        prev.map((ch) => {
          if (!appliedIds.has(ch.sourceChapterId)) return ch;
          return { ...ch, readState: read ? "read" as const : "unread" as const, lastPage: read ? ch.lastPage : 0 };
        }),
      );
    }
  }

  function handleMarkReadUpTo(chapterSourceId: string) {
    const idx = chapters.findIndex((ch) => ch.sourceChapterId === chapterSourceId);
    if (idx === -1) return;
    const ids = chapters
      .slice(0, idx + 1)
      .filter((ch) => ch.readState !== "read")
      .map((ch) => ch.sourceChapterId);
    void handleMarkRead(ids, true);
  }

  function handleJump(chapterNo: number) {
    setJumpTarget(chapterNo);
    if (chapterListRef.current) {
      const el = chapterListRef.current.querySelector(`[data-chapter-no="${chapterNo}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        if (chapters.length === 0) return;
        const closest = chapters.reduce((prev, curr) =>
          Math.abs(curr.chapterNo - chapterNo) < Math.abs(prev.chapterNo - chapterNo) ? curr : prev,
        );
        const closestEl = chapterListRef.current.querySelector(`[data-chapter-no="${closest.chapterNo}"]`);
        closestEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    scheduleTransient(() => setJumpTarget(null), 2000);
  }

  // ── derived ───────────────────────────────────────────────────────

  const downloadedChapterIds = useMemo(
    () => new Set((offline?.chapters ?? []).filter((item) => item.pinned).map((item) => item.sourceChapterId)),
    [offline],
  );
  const downloadingChapterIdSet = useMemo(
    () => new Set(downloadingChapterIds),
    [downloadingChapterIds],
  );
  const readDownloadedChapterIds = useMemo(
    () => getReadDownloadedChapterIds(chapters, downloadedChapterIds),
    [chapters, downloadedChapterIds],
  );

  const { cachingChapterIds, cacheQueuedChapterIds } = useMemo(() => {
    const caching = new Set<string>();
    const queued = new Set<string>();
    for (const run of cacheQueue.runs) {
      if (run.status !== "queued" && run.status !== "running" && run.status !== "canceling") continue;
      for (const task of run.tasks) {
        if (task.seriesId !== sourceId) continue;
        if (task.kind !== "cache") continue;
        if (task.state === "running") caching.add(task.chapterId);
        else if (task.state === "queued") queued.add(task.chapterId);
      }
    }
    return { cachingChapterIds: caching, cacheQueuedChapterIds: queued };
  }, [cacheQueue, sourceId]);

  const readCachedChapterIds = useMemo(
    () => getReadCachedChapterIds(chapters, cachedChapterIds),
    [chapters, cachedChapterIds],
  );
  const localSeriesId = series?.seriesId ?? sourceId;

  const displayedChapters = useMemo(() => {
    let filtered = chapters;
    if (chapterFilter === "unread") {
      filtered = chapters.filter((ch) => ch.readState !== "read");
    }
    else if (chapterFilter === "read") filtered = chapters.filter((ch) => ch.readState === "read");
    else if (chapterFilter === "in-progress") filtered = chapters.filter((ch) => ch.readState === "in-progress");
    else if (chapterFilter === "downloaded") {
      filtered = chapters.filter(
        (ch) =>
          downloadedChapterIds.has(ch.sourceChapterId) ||
          cachedChapterIds.has(ch.sourceChapterId),
      );
    }
    return chaptersReversed ? [...filtered].reverse() : filtered;
  }, [chapters, chaptersReversed, chapterFilter, downloadedChapterIds, cachedChapterIds]);



  const continueChapter = useMemo(() => {
    if (!seriesProgress?.currentChapterId) return null;
    return seriesProgress.currentChapterId;
  }, [seriesProgress]);

  // Newest chapter's publishedAt (unix ms). Drives the "Updated N ago" line
  // under the title. Null when no chapter has a date (source didn't expose one).
  const latestChapterPublishedAt = useMemo(() => {
    let max: number | null = null;
    for (const ch of chapters) {
      const ts = ch.publishedAt ?? null;
      if (ts != null && (max == null || ts > max)) max = ts;
    }
    return max;
  }, [chapters]);

  // ── loading / error ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
      </div>
    );
  }

  if (!series) {
    return (
      <div className="py-32 text-center">
        <p className="font-display text-lg text-text-muted">Series not found</p>
      </div>
    );
  }

  const meta = [series.type, series.status, series.year].filter(Boolean).join(" · ");
  const isAdultSeries = Boolean(series.isAdult);

  // ── render ────────────────────────────────────────────────────────

  const STATUS_DOT_COLORS: Record<LibraryStatus, string> = {
    reading: "bg-reading",
    completed: "bg-completed",
    paused: "bg-paused",
    dropped: "bg-dropped",
    rereading: "bg-rereading",
    planning: "bg-planning",
  };

  // Verb forms of the library status. Used on the status line under
  // the byline — a library status reads more naturally as an action
  // the reader is taking than as a noun attached to the series.
  const STATUS_VERB: Record<LibraryStatus, string> = {
    reading: "Currently reading",
    rereading: "Re-reading",
    completed: "Completed",
    paused: "Paused",
    dropped: "Dropped",
    planning: "On your list",
  };

  return (
    <div className="space-y-5">
      {/* ── Hero ────────────────────────────────────────────────────────
          One self-contained book-jacket block.
            Phone  — cover stacks on top (centered, capped at 180px so
                     it has presence without dominating); title / author
                     / meta / synopsis / tags / CTA / icon toolbar stack
                     below in a single column at full content width.
            sm+    — cover on the left, *left-aligned* (no `mx-auto`),
                     info column to the right filling the remainder.
                     Info is NOT width-capped — capping it leaves a
                     rectangle of dead black to the right of the hero
                     that makes the content look centered within the
                     sidebar-offset layout. The description gets its own
                     prose cap so line length stays readable even when
                     the info column itself is 900px wide.
          The CTA + icon toolbar live *inside* the info column as the
          hero's floor — same column as the synopsis — so the cover
          bottom edge and the info bottom edge line up. No orphan row
          dangling below the hero. */}
      {/* ── Hero — Broadside composition ──────────────────────────
          Phone (<640):  cover stacks centered on top, capped at 160px.
          sm (640+):     cover on the left, info to the right, top-
                         aligned. Cover grows 176 → 208 → 240 at md/lg.
          lg (1024+):    cover drops ~56px below the title's baseline
                         so the serif title lands shoulder-to-shoulder
                         with the cover's top third — the book-jacket
                         gesture.
          Auto-download is NO LONGER in this block. It's a chapter-
          management concern, not series identity — it now lives on
          the Chapters tool shelf below. */}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-8 lg:gap-12">
        <div className="mx-auto w-40 shrink-0 sm:mx-0 sm:w-44 md:w-52 lg:mt-14 lg:w-60">
          <Cover
            src={
              series.coverUrl?.startsWith("http")
                ? `/api/media/page?url=${encodeURIComponent(series.coverUrl)}${series.source ? `&source=${encodeURIComponent(series.source)}` : ""}${coverRefreshToken ? `&v=${coverRefreshToken}` : ""}`
                : `/api/media/cover/${sourceId}${coverRefreshToken ? `?refresh=true&v=${coverRefreshToken}` : ""}`
            }
            alt={series.title}
            className="w-full rounded-sm"
            priority
            sizes="(max-width: 640px) 160px, (max-width: 768px) 176px, (max-width: 1024px) 208px, 240px"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:gap-4">
          {/* ── Eyebrow — type · status · year · updated · AniList.
              The masthead dateline. All-mono caps so the serif title
              below reads as a headline rather than a competitor for
              the meta's attention. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase leading-relaxed tracking-[0.18em] text-text-faint">
            {meta && <span>{meta}</span>}
            {(() => {
              const phrase = formatUpdatedPhrase(latestChapterPublishedAt);
              if (!phrase) return null;
              const lamp = lampFromPublishedAt(latestChapterPublishedAt);
              return (
                <>
                  <span aria-hidden className="opacity-60">·</span>
                  <span
                    title={formatAbsolute(latestChapterPublishedAt) ?? undefined}
                    className={cn(
                      "tabular-nums",
                      lamp ? LAMP_TEXT_CLASS[lamp] : "text-text-faint",
                    )}
                  >
                    {phrase}
                  </span>
                </>
              );
            })()}
            {(() => {
              // Defense in depth: the scraper filters anilistUrl but
              // old DB rows haven't been re-validated. Parse again so
              // a `javascript:` href stored in the DB can't render.
              if (!series.anilistUrl) return null;
              let safeUrl: string | null = null;
              try {
                const u = new URL(series.anilistUrl);
                if (u.protocol === "https:" && u.hostname === "anilist.co") {
                  safeUrl = u.toString();
                }
              } catch {
                safeUrl = null;
              }
              if (!safeUrl) return null;
              return (
                <>
                  <span aria-hidden className="opacity-60">·</span>
                  <a
                    href={safeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 transition-colors hover:text-accent"
                  >
                    <span>AniList</span>
                    <span aria-hidden>↗</span>
                  </a>
                </>
              );
            })()}
          </div>

          {/* ── Title — the headline. No status pill crowding it;
              status moved to its own line below. */}
          <h1 className="font-display text-3xl leading-[1.05] -tracking-[0.01em] text-text sm:text-4xl md:text-[2.75rem] lg:text-[3.25rem]">
            {series.title}
          </h1>

          {/* ── Byline — italic serif, the "whisper" subtitle.
              DESIGN.md reserves italic Instrument Serif for quiet
              subtitles; a byline qualifies. */}
          {series.authors.length > 0 && (
            <p className="font-display text-base italic text-text-muted sm:text-lg">
              by {series.authors.join(" & ")}
            </p>
          )}

          {/* ── Status line — "you are here" for the reader.
              Coloured dot (status tone, not cinnabar) + verb form
              of the status, with the full status picker dropdown
              wired behind it. No pill, no border — reads as type. */}
          {libraryEntryStatus && !isAdultSeries && (
            <div ref={statusMenuRef} className="relative self-start">
              <button
                type="button"
                onClick={() => setShowStatusMenu((v) => !v)}
                disabled={librarySaving}
                className={cn(
                  "inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                  "text-text-muted hover:text-text disabled:opacity-50",
                  showStatusMenu && "text-accent",
                )}
                aria-haspopup="menu"
                aria-expanded={showStatusMenu}
                aria-label={`Library status: ${libraryStatus}. Change status.`}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT_COLORS[libraryStatus])} />
                <span>{STATUS_VERB[libraryStatus]}</span>
                <ChevronDown className={cn("h-3 w-3 text-text-faint transition-transform", showStatusMenu && "rotate-180 text-accent")} />
              </button>
              {showStatusMenu && (
                <div
                  role="menu"
                  className="absolute left-0 top-full z-20 mt-1 min-w-[170px] max-w-[calc(100vw-2rem)] rounded-sm border border-border bg-surface py-1 shadow-lg shadow-void/50 animate-[fade-up-in_120ms_ease-out]"
                >
                  {STATUS_OPTIONS.map((opt) => {
                    const active = libraryStatus === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => {
                          void handleLibrarySave(opt.value);
                          setShowStatusMenu(false);
                        }}
                        className={cn(
                          "relative flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                          active ? "text-accent" : "text-text-muted hover:bg-surface-raised hover:text-text",
                        )}
                      >
                        {active && (
                          <span aria-hidden className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-accent" />
                        )}
                        <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT_COLORS[opt.value])} />
                        <span className={cn("flex-1", active && "font-medium")}>{opt.label}</span>
                        {active && <Check className="h-3 w-3 text-accent" />}
                      </button>
                    );
                  })}

                  {nsfwEnabled && (
                    <>
                      <div aria-hidden className="my-1 h-px bg-border-subtle" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          void handleAdultToggle(!isAdultSeries);
                          setShowStatusMenu(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                      >
                        <Eye className="h-3 w-3 text-text-faint" />
                        <span>{isAdultSeries ? "Move to Main" : "Move to NSFW"}</span>
                      </button>
                    </>
                  )}

                  <div aria-hidden className="my-1 h-px bg-border-subtle" />

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void handleRemoveFromLibrary();
                      setShowStatusMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-dropped transition-colors hover:bg-dropped/10"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Remove from library</span>
                  </button>
                </div>
              )}
            </div>
          )}
          {libraryEntryStatus && isAdultSeries && (
            <div ref={statusMenuRef} className="relative self-start">
              <button
                type="button"
                onClick={() => setShowStatusMenu((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
                  "text-text-muted hover:text-text",
                  showStatusMenu && "text-accent",
                )}
                aria-haspopup="menu"
                aria-expanded={showStatusMenu}
                aria-label="Library actions"
              >
                <span>In library</span>
                <ChevronDown className={cn("h-3 w-3 text-text-faint transition-transform", showStatusMenu && "rotate-180 text-accent")} />
              </button>
              {showStatusMenu && (
                <div
                  role="menu"
                  className="absolute left-0 top-full z-20 mt-1 min-w-[170px] max-w-[calc(100vw-2rem)] rounded-sm border border-border bg-surface py-1 shadow-lg shadow-void/50 animate-[fade-up-in_120ms_ease-out]"
                >
                  {nsfwEnabled && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        void handleAdultToggle(!isAdultSeries);
                        setShowStatusMenu(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                    >
                      <Eye className="h-3 w-3 text-text-faint" />
                      <span>Move to Main</span>
                    </button>
                  )}

                  {nsfwEnabled && <div aria-hidden className="my-1 h-px bg-border-subtle" />}

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void handleRemoveFromLibrary();
                      setShowStatusMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-dropped transition-colors hover:bg-dropped/10"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Remove from library</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Synopsis — quoted paragraph with a thin left rule.
              The rule is typographic, not decorative: it gives the
              description its own weight without needing a card. */}
          {series.description && (
            <div className="space-y-1 border-l border-border pl-4">
              <p
                className="max-w-[62ch] text-sm leading-relaxed text-text-muted"
                style={
                  descExpanded
                    ? undefined
                    : {
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }
                }
              >
                {series.description}
              </p>
              {series.description.length > 200 && (
                <button
                  type="button"
                  onClick={() => setDescExpanded(!descExpanded)}
                  className="text-xs text-text-faint transition-colors hover:text-accent"
                >
                  {descExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}

          {/* ── Tags — prose list, not pills. Genre is metadata, not
              a UI choice; pills make them feel like filters they
              aren't. */}
          {series.tags.length > 0 && (
            <p className="max-w-[62ch] text-sm leading-relaxed">
              <span className="mr-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">
                Tagged
              </span>
              <span className="text-text-muted">
                {series.tags.join(", ")}.
              </span>
            </p>
          )}

          {/* ── Action floor ───────────────────────────────────────────
              Continue reading is the ONE primary. Everything else
              collapses into a thin icon toolbar: Download ↓ / Cache ↓
              / hairline / More ⋯. Lives INSIDE the info column as its
              bottom edge so the hero reads as one artifact — cover
              bottom and info bottom align, no orphan CTA dangling
              below the hero.
                Mobile: CTA stretches full-width (thumb-reach); toolbar
                        flows below centered, not hugging the left.
                Desktop: CTA auto-width on the left, toolbar pushed to
                         the end of the info column via ml-auto. */}
          {libraryEntryStatus ? (
            <div className="mt-1 flex items-center gap-2 sm:gap-3">
              {continueChapter ? (
                <LinkButton
                  href={buildReaderHref(localSeriesId, continueChapter, sourceName)}
                  variant="primary"
                  size="md"
                  className="w-full sm:w-auto"
                >
                  Continue reading
                </LinkButton>
              ) : chapters.length > 0 ? (
                <LinkButton
                  href={buildReaderHref(localSeriesId, chapters[0]?.sourceChapterId ?? "", sourceName)}
                  variant="primary"
                  size="md"
                  className="w-full sm:w-auto"
                >
                  Start reading
                </LinkButton>
              ) : null}

            </div>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={() => void handleLibrarySave()}
              disabled={librarySaving}
              loading={librarySaving}
              className="w-full sm:w-auto"
            >
              {librarySaving ? "Adding…" : "Add to Library"}
            </Button>
          )}
        </div>
      </div>

      {/* ── Tags (compact) ─────────────────────────────────────────── */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">Tags</span>
            {tags.map((t) => (
              <label key={t.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={selectedTagIds.includes(t.id)}
                  onChange={(e) => void handleTagToggle(t.id, e.target.checked)}
                  className="h-3 w-3 rounded-sm border-border bg-surface-raised text-accent accent-accent"
                />
                {t.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />}
                {t.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── Toast ───────────────────────────────────────────────────── */}
      {toast && (
        <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-sm border border-border bg-surface px-4 py-2 text-sm text-text shadow-lg md:bottom-8">
          {toast}
        </div>
      )}

      {/* ── Chapter list ────────────────────────────────────────────── */}
      <section>
        {/* Chapter toolbar */}
        <div className="mb-3 space-y-3">
          {/* ── Row 1 — title + standing order (auto-download) ──
              The Broadside claim: auto-download is a chapter-
              management concern, not series identity. It lives
              here, on the Chapters shelf, as an inline marginal
              control — not a card in the middle of the page.
                Mobile: shelf wraps under the title. Tablet+: sits
                inline on the same row, pushed right via ml-auto. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="flex items-baseline gap-2">
              <span className="font-display text-xl text-text">Chapters</span>
              {!chaptersLoading && (
                <span className="font-mono text-sm text-text-faint">{chapters.length}</span>
              )}
            </h2>

            {offline && offline.storage.pinnedChapters > 0 && (
              <span className="rounded-full bg-surface-raised px-2 py-0.5 font-mono text-[11px] text-text-faint">
                {offline.storage.pinnedChapters} ↓
                {offline.storage.pinnedBytes > 0 && (
                  <> · {formatBytes(offline.storage.pinnedBytes)}</>
                )}
              </span>
            )}

            {libraryEntryStatus && (
              <div className="ml-auto flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoDownloadNewEnabled}
                  aria-label="Auto-download new chapters"
                  onClick={() => setAutoDownloadNewEnabled(!autoDownloadNewEnabled)}
                  disabled={policySaving}
                  className="group inline-flex items-center gap-2 disabled:opacity-50"
                >
                  <span
                    className={cn(
                      "relative inline-flex h-3.5 w-7 shrink-0 rounded-full p-0.5 transition-colors duration-200",
                      autoDownloadNewEnabled ? "bg-accent" : "bg-border",
                    )}
                  >
                    <span
                      className={cn(
                        "h-2.5 w-2.5 rounded-full transition-transform duration-200",
                        autoDownloadNewEnabled
                          ? "translate-x-3 bg-[color:var(--color-text-on-accent)]"
                          : "translate-x-0 bg-text-muted",
                      )}
                    />
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[10px] uppercase tracking-[0.14em] transition-colors group-hover:text-text",
                      autoDownloadNewEnabled ? "text-text" : "text-text-muted",
                    )}
                  >
                    Auto-download
                  </span>
                </button>

                {autoDownloadNewEnabled && !policyStatus && !policySaving && (
                  <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-text-faint">
                    <span>keep</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={autoDownloadNewLimit}
                      onChange={(e) => {
                        const parsed = Number.parseInt(e.target.value || "1", 10);
                        setAutoDownloadNewLimit(Number.isFinite(parsed) ? parsed : 1);
                      }}
                      className="w-9 border-0 border-b border-border bg-transparent pb-0.5 text-center text-xs tracking-normal text-text tabular-nums focus:border-accent focus:outline-none"
                      aria-label="Auto-download chapter limit"
                    />
                    <span>most recent</span>
                  </label>
                )}

                {policySaving && (
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent"
                    aria-live="polite"
                  >
                    saving…
                  </span>
                )}
                {policyStatus && !policySaving && (
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.14em] text-dropped"
                    aria-live="polite"
                  >
                    {policyStatus}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── Row 2 — filters and sort ─────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <JumpToChapter onJump={handleJump} />

            {/* Filters — segmented control, each segment reads as a chip. */}
            <div className="flex items-center gap-0.5 rounded-sm border border-border-subtle">
              {([
                { id: "all" as const, label: "All", icon: null, activeClass: "text-text" },
                { id: "unread" as const, label: "Unread", icon: Eye, activeClass: "text-accent" },
                { id: "read" as const, label: "Read", icon: EyeOff, activeClass: "text-completed" },
                { id: "downloaded" as const, label: "Saved", icon: Download, activeClass: "text-text" },
              ] as const).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setChapterFilter(f.id)}
                  className={cn(
                    "flex items-center gap-1 px-1.5 py-1 text-[10px] sm:px-2 sm:py-1.5 sm:text-[11px] transition-colors",
                    chapterFilter === f.id
                      ? `bg-surface-raised ${f.activeClass}`
                      : "text-text-faint hover:text-text-muted",
                  )}
                  title={`Show ${f.label.toLowerCase()} chapters`}
                >
                  {f.icon && <f.icon className="hidden sm:block h-3 w-3" />}
                  {f.label}
                </button>
              ))}
            </div>

            {/* ── Tools — Download / Cache / Sort grouped together on
                the right. Download & Cache hold both bulk actions
                (Download next 5 chapters, Cache everything…) and
                catch-all series actions (Delete read downloads,
                Clear cached read, Refresh metadata). */}
            <div className="ml-auto flex items-center gap-0.5">
              {libraryEntryStatus && (
                <>
                  <div ref={downloadMenuRef} className="relative">
                    <Button
                      variant="ghost"
                      onClick={() => setShowDownloadMenu((v) => !v)}
                      disabled={offlineBusyId !== null || chapters.length === 0}
                      title="Download chapters"
                      aria-label="Download chapters"
                      leading={<HardDriveDownload className={cn("h-4 w-4", offlineBusyId === "__bulk" && "animate-pulse")} />}
                      trailing={<ChevronDown className="h-3 w-3" />}
                    >
                      <span className="hidden sm:inline">Download</span>
                    </Button>
                    {showDownloadMenu && (
                      <div
                        role="menu"
                        className="absolute right-0 top-full z-20 mt-1 min-w-[180px] max-w-[calc(100vw-2rem)] rounded-sm border border-border bg-surface py-1 shadow-lg shadow-void/50 animate-[fade-up-in_120ms_ease-out]"
                      >
                        {DOWNLOAD_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              void handleBulkDownload(opt.value);
                              setShowDownloadMenu(false);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                          >
                            <Download className="h-3 w-3 text-text-faint" />
                            {opt.label}
                          </button>
                        ))}

                        <div aria-hidden className="my-1 h-px bg-border-subtle" />

                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            void handleDeleteReadChapters();
                            setShowDownloadMenu(false);
                          }}
                          disabled={offlineBusyId !== null || readDownloadedChapterIds.length === 0}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Trash2 className="h-3 w-3 text-text-faint" />
                          <span className="flex-1">Delete read downloads</span>
                          {readDownloadedChapterIds.length > 0 && (
                            <span className="font-mono text-[10px] text-text-faint">
                              {readDownloadedChapterIds.length}
                            </span>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  <div ref={cacheMenuRef} className="relative">
                    <Button
                      variant="ghost"
                      onClick={() => setShowCacheMenu((v) => !v)}
                      disabled={cacheBusy !== null || chapters.length === 0}
                      title="Cache chapters on this device for offline reading"
                      aria-label="Cache chapters"
                      leading={<HardDrive className={cn("h-4 w-4", cacheBusy === "__bulk" && "animate-pulse")} />}
                      trailing={<ChevronDown className="h-3 w-3" />}
                    >
                      <span className="hidden sm:inline">Cache</span>
                    </Button>
                    {showCacheMenu && (
                      <div
                        role="menu"
                        className="absolute right-0 top-full z-20 mt-1 min-w-[180px] max-w-[calc(100vw-2rem)] rounded-sm border border-border bg-surface py-1 shadow-lg shadow-void/50 animate-[fade-up-in_120ms_ease-out]"
                      >
                        {CACHE_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              void handleBulkCache(opt.value);
                              setShowCacheMenu(false);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                          >
                            <HardDrive className="h-3 w-3 text-text-faint" />
                            {opt.label}
                          </button>
                        ))}

                        <div aria-hidden className="my-1 h-px bg-border-subtle" />

                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            void handleDeleteReadCachedChapters();
                            setShowCacheMenu(false);
                          }}
                          disabled={cacheBusy !== null || readCachedChapterIds.length === 0}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <HardDrive className="h-3 w-3 text-text-faint" />
                          <span className="flex-1">Clear cached read</span>
                          {readCachedChapterIds.length > 0 && (
                            <span className="font-mono text-[10px] text-text-faint">
                              {readCachedChapterIds.length}
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            void handleRefresh();
                            setShowCacheMenu(false);
                          }}
                          disabled={refreshing}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text disabled:opacity-40"
                        >
                          <RefreshCw className={cn("h-3 w-3 text-text-faint", refreshing && "animate-spin")} />
                          <span>Refresh metadata</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <span aria-hidden className="mx-1 h-5 w-px bg-border-subtle" />
                </>
              )}

              <Button
                variant="ghost"
                onClick={() => setChaptersReversed(!chaptersReversed)}
                leading={chaptersReversed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              >
                {chaptersReversed ? "Oldest" : "Newest"}
              </Button>
            </div>
          </div>
        </div>

        {/* Chapter rows */}
        {chaptersLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          </div>
        ) : chapters.length === 0 ? (
          <p className="py-12 text-center text-sm text-text-faint">No chapters available.</p>
        ) : displayedChapters.length === 0 ? (
          <p className="py-12 text-center text-sm text-text-faint">No {chapterFilter} chapters.</p>
        ) : (
          <div ref={chapterListRef} className="divide-y divide-border-subtle">
            {displayedChapters.map((ch) => {
              const isCurrent = continueChapter === ch.sourceChapterId;
              const isLocalDownloading = downloadingChapterIdSet.has(ch.sourceChapterId);
              const isWorkerRunning = workerRunningIds.has(ch.sourceChapterId);
              const isWorkerQueued = workerQueuedIds.has(ch.sourceChapterId);
              const isDownloading = isLocalDownloading || isWorkerRunning;
              const isQueued = !isDownloading && isWorkerQueued;
              const isDownloaded = downloadedChapterIds.has(ch.sourceChapterId);
              const isCached = cachedChapterIds.has(ch.sourceChapterId);
              const isCaching = cachingChapterIds.has(ch.sourceChapterId);
              const isCacheQueued = !isCaching && cacheQueuedChapterIds.has(ch.sourceChapterId);
              return (
                <ChapterListItem
                  key={ch.sourceChapterId}
                  seriesId={localSeriesId}
                  seriesSource={sourceName}
                  chapterId={ch.sourceChapterId}
                  chapterNo={ch.chapterNo}
                  title={ch.title}
                  isCurrent={isCurrent}
                  readState={ch.readState}
                  publishedAt={ch.publishedAt ?? null}
                  onMarkRead={() => void handleMarkRead([ch.sourceChapterId], true)}
                  onMarkUnread={() => void handleMarkRead([ch.sourceChapterId], false)}
                  onMarkReadUpTo={() => handleMarkReadUpTo(ch.sourceChapterId)}
                  className={
                    jumpTarget !== null && Math.abs(ch.chapterNo - jumpTarget) < 0.5
                      ? "bg-accent-faint"
                      : undefined
                  }
                  trailing={
                    <div className="flex items-center gap-2">
                      {isDownloading && (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-accent">
                          <span className="h-3 w-3 rounded-full border-[1.5px] border-accent/30 border-t-accent animate-spin" />
                          <span className="hidden sm:inline">Downloading</span>
                        </span>
                      )}
                      {isQueued && (
                        <span className="font-mono text-[10px] text-text-faint">Queued</span>
                      )}
                      {isCaching && (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-accent">
                          <span className="h-3 w-3 rounded-full border-[1.5px] border-accent/30 border-t-accent animate-spin" />
                          <span className="hidden sm:inline">Caching</span>
                        </span>
                      )}
                      {isCacheQueued && (
                        <span className="font-mono text-[10px] text-text-faint">Cache queued</span>
                      )}
                      {/* Per-chapter toggles. When the chapter is in the state
                          (downloaded / cached), the button reads as a quiet
                          completed-color affordance: "this is stamped, tap to
                          un-stamp". When absent, it reads as ghost hover —
                          present but deferring to the chapter row it sits in. */}
                      <button
                        type="button"
                        onClick={() => void handleToggleChapterDownload(ch.sourceChapterId, isDownloaded)}
                        disabled={
                          isDownloading ||
                          isQueued ||
                          offlineBusyId === "__bulk" ||
                          offlineBusyId === "__delete-read" ||
                          offlineBusyId === ch.sourceChapterId
                        }
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm px-1.5 py-1 font-mono text-[10px] transition-colors",
                          isDownloaded
                            ? "text-completed hover:bg-dropped/10 hover:text-dropped"
                            : "text-text-faint hover:text-accent",
                          (isDownloading || isQueued) && "opacity-50",
                        )}
                        aria-label={isDownloaded ? "Remove download" : "Download chapter"}
                      >
                        <Download className="h-3 w-3" />
                        <span className="hidden sm:inline">{isDownloaded ? "Downloaded" : "Download"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleChapterCache(ch.sourceChapterId, isCached)}
                        disabled={
                          isCaching ||
                          isCacheQueued ||
                          cacheBusy === "__bulk" ||
                          cacheBusy === "__delete-read" ||
                          cacheBusy === ch.sourceChapterId
                        }
                        className={cn(
                          "inline-flex items-center gap-1 rounded-sm px-1.5 py-1 font-mono text-[10px] transition-colors",
                          isCached
                            ? "text-completed hover:bg-dropped/10 hover:text-dropped"
                            : "text-text-faint hover:text-accent",
                          (isCaching || isCacheQueued) && "opacity-50",
                        )}
                        aria-label={isCached ? "Remove from cache" : "Cache chapter on this device"}
                        title={isCached ? "Cached on this device" : "Cache on this device"}
                      >
                        <HardDrive className="h-3 w-3" />
                        <span className="hidden sm:inline">{isCached ? "Cached" : "Cache"}</span>
                      </button>
                    </div>
                  }
                  data-chapter-no={ch.chapterNo}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
