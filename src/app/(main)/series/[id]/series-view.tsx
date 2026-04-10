"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  HardDriveDownload,
  RefreshCw,
  Eye,
  EyeOff,
  Trash2,
} from "lucide-react";
import { Cover } from "@/components/ui/cover";
import { SelectDropdown } from "@/components/ui/select";
import { ChapterListItem } from "@/components/chapter-list-item";
import { JumpToChapter } from "@/components/ui/jump-to-chapter";
import { useNsfw } from "@/lib/nsfw-context";
import { buildReaderHref, buildSeriesApiPath } from "@/lib/reader/url";
import { cn } from "@/lib/utils";
import type { SeriesDetail } from "@/lib/sources/types";
import {
  getBulkDownloadTargetChapterIds,
  getReadDownloadedChapterIds,
  type DownloadScope,
} from "./offline-actions";

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
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3_500);
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

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

  // Poll worker download state every 4s
  useEffect(() => {
    void refreshWorkerDownloads();
    const id = window.setInterval(() => void refreshWorkerDownloads(), 4_000);
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
      if (res.ok) {
        const entry = (await res.json()) as { status?: LibraryStatus } | null;
        const resolvedStatus = entry?.status ?? targetStatus;
        setLibraryEntryStatus(resolvedStatus);
        setLibraryStatus(resolvedStatus);
      }
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
      }
    } catch { /* silent */ }
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
        return;
      }

      const entry = await res.json() as { adult: boolean };
      setSeries((prev) => (prev ? { ...prev, isAdult: entry.adult } : prev));
      showToast(entry.adult ? "Moved to NSFW" : "Moved to main library");
    } catch {
      // silent
    }
  }

  async function handleTagToggle(tagId: string, checked: boolean) {
    if (!series) return;
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
      if (res.ok) setSelectedTagIds(((await res.json()) as { tagIds: string[] }).tagIds);
    } catch { /* silent */ }
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

      if (!res.ok) {
        setPolicyStatus("Failed to save");
        return;
      }

      setPolicyStatus("Saved");
      setTimeout(() => setPolicyStatus(null), 2000);
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
    setTimeout(() => setJumpTarget(null), 2000);
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
  const localSeriesId = series?.seriesId ?? sourceId;

  const displayedChapters = useMemo(() => {
    let filtered = chapters;
    if (chapterFilter === "unread") {
      filtered = chapters.filter((ch) => ch.readState !== "read");
    }
    else if (chapterFilter === "read") filtered = chapters.filter((ch) => ch.readState === "read");
    else if (chapterFilter === "in-progress") filtered = chapters.filter((ch) => ch.readState === "in-progress");
    else if (chapterFilter === "downloaded") filtered = chapters.filter((ch) => downloadedChapterIds.has(ch.sourceChapterId));
    return chaptersReversed ? [...filtered].reverse() : filtered;
  }, [chapters, chaptersReversed, chapterFilter, downloadedChapterIds]);



  const continueChapter = useMemo(() => {
    if (!seriesProgress?.currentChapterId) return null;
    return seriesProgress.currentChapterId;
  }, [seriesProgress]);

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

  return (
    <div className="space-y-5">
      {/* ── Hero: cover + info ──────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex gap-4 sm:gap-8">
          {/* Cover */}
          <div className="w-28 shrink-0 sm:w-44">
            <Cover
              src={
                series.coverUrl?.startsWith("http")
                  ? `/api/media/page?url=${encodeURIComponent(series.coverUrl)}${series.source ? `&source=${encodeURIComponent(series.source)}` : ""}${coverRefreshToken ? `&v=${coverRefreshToken}` : ""}`
                  : `/api/media/cover/${sourceId}${coverRefreshToken ? `?refresh=true&v=${coverRefreshToken}` : ""}`
              }
              alt={series.title}
              className="w-full rounded-sm"
              priority
              sizes="(max-width: 640px) 112px, 176px"
            />
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1 space-y-1.5">
            <h1 className="font-display text-xl leading-tight text-text sm:text-3xl">
              {series.title}
            </h1>
            {series.authors.length > 0 && (
              <p className="text-xs text-text-muted sm:text-sm">
                {series.authors.join(" & ")}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {meta && <p className="text-[11px] text-text-faint sm:text-xs">{meta}</p>}
              {series.anilistUrl && (
                <a
                  href={series.anilistUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-text-faint transition-colors hover:text-accent sm:text-xs"
                >
                  <ExternalLink className="h-3 w-3" />
                  AniList
                </a>
              )}
            </div>
          </div>
        </div>

        {/* CTA — full width below hero for easy thumb reach on mobile */}
        {continueChapter ? (
          <Link
            href={buildReaderHref(localSeriesId, continueChapter, sourceName)}
            className="flex w-full items-center justify-center rounded-sm bg-accent py-3 text-sm font-medium text-void transition-colors hover:bg-accent-muted sm:w-auto sm:px-6 sm:py-2.5"
          >
            Continue reading
          </Link>
        ) : chapters.length > 0 ? (
          <Link
            href={buildReaderHref(localSeriesId, chapters[0]?.sourceChapterId ?? "", sourceName)}
            className="flex w-full items-center justify-center rounded-sm bg-accent py-3 text-sm font-medium text-void transition-colors hover:bg-accent-muted sm:w-auto sm:px-6 sm:py-2.5"
          >
            Start reading
          </Link>
        ) : null}
      </div>

      {/* ── Description ───────────────────────────────────────────── */}
      {series.description && (
        <div>
          <p
            className="text-sm leading-relaxed text-text-muted"
            style={
              descExpanded
                ? undefined
                : { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }
            }
          >
            {series.description}
          </p>
          {series.description.length > 200 && (
            <button
              onClick={() => setDescExpanded(!descExpanded)}
              className="mt-0.5 text-xs font-medium text-accent transition-colors hover:text-accent-muted"
            >
              {descExpanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      {series.tags.length > 0 && (
        <div className="-mt-4 flex flex-wrap gap-1">
          {series.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-surface-raised px-2 py-0.5 text-[11px] text-text-faint">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* ── Actions bar ─────────────────────────────────────────────── */}
      {libraryEntryStatus ? (
        <div className="space-y-2 rounded-sm border border-border-subtle bg-surface px-3 py-2">
          {/* Row 1: status + remove + NSFW toggle */}
          <div className="flex flex-wrap items-center gap-2">
            {isAdultSeries ? (
              <span className="rounded-sm bg-surface-raised px-2.5 py-2 text-xs text-text-muted">
                In library
              </span>
            ) : (
              <SelectDropdown
                value={libraryStatus}
                onChange={(e) => {
                  const val = e.target.value as LibraryStatus;
                  void handleLibrarySave(val);
                }}
                disabled={librarySaving}
                className="w-24 text-xs sm:w-28"
                aria-label="Library status"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </SelectDropdown>
            )}

            <button
              type="button"
              onClick={() => void handleRemoveFromLibrary()}
              className="inline-flex items-center gap-1 rounded-sm border border-border px-2.5 py-2 text-xs text-text-faint transition-colors hover:border-red-500/50 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Remove</span>
            </button>

            {nsfwEnabled && (
              <button
                type="button"
                onClick={() => void handleAdultToggle(!isAdultSeries)}
                className="inline-flex items-center gap-1 rounded-sm border border-border px-2.5 py-2 text-xs text-text-faint transition-colors hover:border-accent hover:text-accent"
              >
                {isAdultSeries ? "Move to Main" : "Move to NSFW"}
              </button>
            )}
          </div>

          {/* Row 2: download actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2">
            {/* Download dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                disabled={offlineBusyId !== null || chapters.length === 0}
                className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                title="Download chapters"
              >
                <HardDriveDownload className={cn("h-3.5 w-3.5", offlineBusyId === "__bulk" && "animate-pulse")} />
                <span>{offlineBusyId === "__bulk" ? "Downloading…" : "Download"}</span>
                <ChevronDown className="h-3 w-3" />
              </button>
              {showDownloadMenu && (
                <div className="absolute left-0 top-full z-10 mt-1 min-w-[180px] rounded-sm border border-border bg-surface py-1 shadow-lg sm:left-auto sm:right-0">
                  {DOWNLOAD_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => void handleBulkDownload(opt.value)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                    >
                      <Download className="h-3 w-3" />
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void handleDeleteReadChapters()}
              disabled={offlineBusyId !== null || readDownloadedChapterIds.length === 0}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              aria-label={offlineBusyId === "__delete-read" ? "Deleting…" : `Delete read${readDownloadedChapterIds.length > 0 ? ` (${readDownloadedChapterIds.length})` : ""}`}
            >
              <Trash2 className={cn("h-3.5 w-3.5", offlineBusyId === "__delete-read" && "animate-pulse")} />
              <span className="hidden sm:inline" aria-hidden="true">
                {offlineBusyId === "__delete-read" ? "Deleting…" : `Delete read${readDownloadedChapterIds.length > 0 ? ` (${readDownloadedChapterIds.length})` : ""}`}
              </span>
              <span className="sm:hidden" aria-hidden="true">
                {offlineBusyId === "__delete-read" ? "…" : `Read${readDownloadedChapterIds.length > 0 ? ` (${readDownloadedChapterIds.length})` : ""}`}
              </span>
            </button>

            <button
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
              title="Refresh from source"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Refresh"}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-sm border border-border-subtle bg-surface px-3 py-2">
          <button
            type="button"
            onClick={() => void handleLibrarySave()}
            disabled={librarySaving}
            className="inline-flex items-center gap-1.5 rounded-sm bg-accent px-4 py-2 text-xs font-medium text-void transition-colors hover:bg-accent-muted disabled:opacity-50"
          >
            {librarySaving ? "Adding…" : "Add to Library"}
          </button>
        </div>
      )}

      <div className="rounded-sm border border-border-subtle bg-surface">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-1.5">
          <Download className="h-3 w-3 text-text-faint" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-text-faint">Auto-download</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-3 py-2">
          <label className="inline-flex items-center gap-2 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={autoDownloadNewEnabled}
              onChange={(e) => setAutoDownloadNewEnabled(e.target.checked)}
              className="h-3.5 w-3.5 rounded-sm border-border bg-surface-raised text-accent accent-accent"
              aria-label="Auto-download new chapters"
            />
            New chapters
          </label>

          <label className="inline-flex items-center gap-2 text-xs text-text-muted">
            Limit
            <input
              type="number"
              min={1}
              max={50}
              value={autoDownloadNewLimit}
              onChange={(e) => {
                const parsed = Number.parseInt(e.target.value || "1", 10);
                setAutoDownloadNewLimit(Number.isFinite(parsed) ? parsed : 1);
              }}
              className="w-16 rounded-sm border border-border bg-surface-raised px-2 py-1 text-xs text-text"
              aria-label="Auto-download chapter limit"
            />
          </label>

          {policySaving && (
            <span className="text-[11px] text-text-faint">Saving…</span>
          )}
          {policyStatus && !policySaving && (
            <span className="text-[11px] text-completed">{policyStatus}</span>
          )}
        </div>
      </div>

      {/* ── Tags (compact) ─────────────────────────────────────────── */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-widest text-text-faint">Tags</span>
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
        <div className="mb-3 flex flex-wrap items-center gap-2">
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

          <div className="flex-1" />

          <JumpToChapter onJump={handleJump} />

          {/* Filters */}
          <div className="flex items-center gap-0.5 rounded-sm border border-border-subtle">
            {([
              { id: "all" as const, label: "All", icon: null, activeClass: "text-text" },
              { id: "unread" as const, label: "Unread", icon: Eye, activeClass: "text-accent" },
              { id: "read" as const, label: "Read", icon: EyeOff, activeClass: "text-completed" },
              { id: "downloaded" as const, label: "Saved", icon: Download, activeClass: "text-text" },
            ] as const).map((f) => (
              <button
                key={f.id}
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

          <button
            onClick={() => setChaptersReversed(!chaptersReversed)}
            className="flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
          >
            {chaptersReversed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {chaptersReversed ? "Oldest" : "Newest"}
          </button>
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
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-accent">
                          <span className="h-3 w-3 rounded-full border-[1.5px] border-accent/30 border-t-accent animate-spin" />
                          <span className="hidden sm:inline">Downloading</span>
                        </span>
                      )}
                      {isQueued && (
                        <span className="text-[10px] text-text-faint">Queued</span>
                      )}
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
                          "inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[10px] font-medium transition-colors",
                          isDownloaded
                            ? "border-completed/50 text-completed hover:bg-completed/10"
                            : "border-border text-text-faint hover:border-accent hover:text-accent",
                          (isDownloading || isQueued) && "opacity-50",
                        )}
                        aria-label={isDownloaded ? "Remove download" : "Download chapter"}
                      >
                        <Download className="h-3 w-3" />
                        <span className="hidden sm:inline">{isDownloaded ? "Downloaded" : "Download"}</span>
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
