"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  HardDrive,
  Settings2,
  X,
} from "lucide-react";
import { buildReaderHref, buildSeriesHref } from "@/lib/reader/url";
import { cn } from "@/lib/utils";
import { ChapterTransition } from "@/components/chapter-transition";
import type { Chapter, ChapterPage } from "@/lib/sources/types";
import { enqueueCacheRun, useCacheQueue } from "@/lib/offline/cache-queue";
import { getCachedChapter, makeCacheKey } from "@/lib/offline/cache-db";
import { enqueueProgress } from "@/lib/offline/outbox";
import { useOfflineMode } from "@/lib/offline/offline-mode-context";
import type { ReadingDirection, FitMode } from "@/lib/reader/state";

interface ReaderStateResponse {
  preferences: {
    readingDirection: ReadingDirection;
    fitMode: FitMode;
  };
  progress: {
    currentPage: number;
    scrollOffset?: number;
    completed: boolean;
    updatedAt: string | null;
  };
}

function clampScrollRatio(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

const DEFAULT_PREFERENCES: ReaderStateResponse["preferences"] = {
  readingDirection: "vertical",
  fitMode: "width",
};

const DEFAULT_PRELOAD_WINDOW = 5;
const PRELOAD_MULTIPLIER = 2;
const VERTICAL_EAGER_PAGE_COUNT = 3;
const PRELOAD_STORAGE_KEY = "reader:preload-window";
const PROGRESS_BAR_KEY = "reader:show-progress-bar";
const DIRECTION_KEY = "reader:default-direction";
const FIT_MODE_KEY = "reader:default-fit-mode";
const AUTOSCROLL_SPEED_KEY = "reader:autoscroll-speed";
const DEFAULT_AUTOSCROLL_SPEED = 70;
const MIN_AUTOSCROLL_SPEED = 20;
const MAX_AUTOSCROLL_SPEED = 500;
const AUTOSCROLL_SPEED_OPTIONS = [30, 50, 70, 90, 120, 160, 220, 300, 400, 500];

const DIRECTION_LABELS: Record<ReadingDirection, string> = {
  vertical: "Vertical",
  ltr: "Left → Right",
  rtl: "Right → Left",
};

const FIT_LABELS: Record<FitMode, string> = {
  width: "Fit width",
  height: "Fit height",
  original: "Original",
};

// Image retry with exponential backoff
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1500;

// Double-tap detection: two taps within 300ms in the center 1/3 of the screen
const DOUBLE_TAP_DELAY_MS = 300;

function normalizeAutoscrollSpeed(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_AUTOSCROLL_SPEED;
  const clamped = Math.min(Math.max(Math.round(value), MIN_AUTOSCROLL_SPEED), MAX_AUTOSCROLL_SPEED);
  return AUTOSCROLL_SPEED_OPTIONS.reduce((closest, option) => {
    const closestDistance = Math.abs(closest - clamped);
    const optionDistance = Math.abs(option - clamped);
    return optionDistance < closestDistance ? option : closest;
  }, AUTOSCROLL_SPEED_OPTIONS[0]);
}

function getStoredAutoscrollSpeed() {
  if (typeof window === "undefined") {
    return DEFAULT_AUTOSCROLL_SPEED;
  }

  try {
    const savedSpeed = window.localStorage.getItem(AUTOSCROLL_SPEED_KEY);
    const parsedSpeed = savedSpeed ? Number.parseFloat(savedSpeed) : Number.NaN;
    return Number.isFinite(parsedSpeed)
      ? normalizeAutoscrollSpeed(parsedSpeed)
      : DEFAULT_AUTOSCROLL_SPEED;
  } catch {
    return DEFAULT_AUTOSCROLL_SPEED;
  }
}

function getLocalStorageDefaults(): typeof DEFAULT_PREFERENCES {
  try {
    const direction = window.localStorage.getItem(DIRECTION_KEY);
    const fitMode = window.localStorage.getItem(FIT_MODE_KEY);
    return {
      readingDirection:
        direction === "vertical" || direction === "ltr" || direction === "rtl"
          ? direction
          : DEFAULT_PREFERENCES.readingDirection,
      fitMode:
        fitMode === "width" || fitMode === "height" || fitMode === "original"
          ? fitMode
          : DEFAULT_PREFERENCES.fitMode,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function clampPage(page: number, pageCount: number) {
  return Math.min(Math.max(page, 0), Math.max(pageCount - 1, 0));
}

function getTouchDistance(touches: TouchList) {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getTouchCenter(touches: TouchList) {
  if (touches.length < 2) return { x: touches[0].clientX, y: touches[0].clientY };
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  };
}

function nextReadingDirection(direction: ReadingDirection): ReadingDirection {
  if (direction === "vertical") return "ltr";
  if (direction === "ltr") return "rtl";
  return "vertical";
}

function nextFitMode(fitMode: FitMode): FitMode {
  if (fitMode === "width") return "height";
  if (fitMode === "height") return "original";
  return "width";
}

function getMaxConcurrentPreloads(preloadWindow: number) {
  return Math.max(1, preloadWindow);
}

function getFetchPriorityForDistance(
  distance: number,
  preloadWindow: number,
): "high" | "auto" | "low" {
  const normalizedWindow = Math.max(preloadWindow, 1);
  const highDistance = Math.max(1, Math.ceil(normalizedWindow / 3));
  const autoDistance = Math.max(highDistance, normalizedWindow);

  if (distance <= highDistance) return "high";
  if (distance <= autoDistance) return "auto";
  return "low";
}

function getVerticalEagerPageUpperBound(
  currentPage: number,
  pageCount: number,
) {
  return Math.min(
    currentPage + Math.max(VERTICAL_EAGER_PAGE_COUNT - 1, 0),
    Math.max(pageCount - 1, 0),
  );
}

export function ReaderView({
  seriesId,
  seriesSource = null,
  chapterId,
}: {
  seriesId: string;
  seriesSource?: string | null;
  chapterId: string;
}) {
  const router = useRouter();
  const { isOffline } = useOfflineMode();
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const restoreDoneRef = useRef(false);
  // Fractional position (0..1) within the current page. Captured as the user
  // scrolls so we can resume tall webtoon pages at the exact vertical spot.
  const scrollRatioRef = useRef(0);
  // Ratio awaiting application once the target page's image has loaded and
  // laid out at its real height. Cleared after restoration (or abandonment).
  const pendingScrollRatioRef = useRef<number | null>(null);
  const preferencesLoadedRef = useRef(false);
  const saveAbortRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const preloadedUrlsRef = useRef<Set<string>>(new Set());
  const preloadImageRefs = useRef<Map<string, HTMLImageElement>>(new Map());
  const preloadQueueRef = useRef<string[]>([]);
  const activePreloadUrlsRef = useRef<Set<string>>(new Set());
  const processPreloadQueueRef = useRef<() => void>(() => { });
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollLastTsRef = useRef<number | null>(null);
  const scrollUpdateRafRef = useRef<number | null>(null);
  const lastTapTimeRef = useRef(0);
  const singleTapTimerRef = useRef<number | null>(null);
  const settingsOpenedAtRef = useRef(0);

  const [pages, setPages] = useState<ChapterPage[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCached, setIsCached] = useState(false);
  const [seriesMeta, setSeriesMeta] = useState<{ title: string; coverUrl: string | null } | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProgressBar, setShowProgressBar] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [preloadWindow, setPreloadWindow] = useState(DEFAULT_PRELOAD_WINDOW);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(false);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(getStoredAutoscrollSpeed);
  const [stateReady, setStateReady] = useState(false);
  const [loadedPageUrls, setLoadedPageUrls] = useState<Record<string, true>>({});
  const [failedPageUrls, setFailedPageUrls] = useState<Record<string, true>>({});
  const [pageRetryVersions, setPageRetryVersions] = useState<Record<string, number>>({});
  const retryCountMapRef = useRef<Record<string, number>>({});
  const retryTimerRefs = useRef<Map<string, number>>(new Map());
  const [preloadProgress, setPreloadProgress] = useState({ loaded: 0, total: 0 });
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zoomOrigin, setZoomOrigin] = useState({ x: 0, y: 0 });
  const zoomContainerRef = useRef<HTMLDivElement>(null);
  const touchStateRef = useRef<{
    initialDistance: number;
    initialZoom: number;
    lastX: number;
    lastY: number;
    isPanning: boolean;
    isPinching: boolean;
  }>({ initialDistance: 0, initialZoom: 1, lastX: 0, lastY: 0, isPanning: false, isPinching: false });
  const zoomLevelRef = useRef(1);

  const cacheQueue = useCacheQueue();
  const currentIdx = chapters.findIndex((item) => item.sourceChapterId === chapterId);
  const currentChapter = currentIdx >= 0 ? chapters[currentIdx] : null;
  const prevChapter = currentIdx > 0 ? chapters[currentIdx - 1] : null;
  const nextChapter =
    currentIdx >= 0 && currentIdx < chapters.length - 1 ? chapters[currentIdx + 1] : null;

  const cacheTask = cacheQueue.runs
    .flatMap((run) => run.tasks)
    .find(
      (task) =>
        task.seriesId === seriesId &&
        task.chapterId === chapterId &&
        (task.state === "queued" || task.state === "running"),
    );
  const cacheKind = cacheTask?.kind ?? "cache";
  const isCaching = cacheTask?.state === "running" && cacheKind === "cache";
  const isCacheQueued = cacheTask?.state === "queued" && cacheKind === "cache";
  const isUncaching =
    cacheTask !== undefined && cacheKind === "delete";

  const cacheTerminalSignature = cacheQueue.runs
    .filter((run) =>
      run.tasks.some(
        (task) =>
          task.seriesId === seriesId &&
          task.chapterId === chapterId &&
          (task.state === "succeeded" ||
            task.state === "failed" ||
            task.state === "canceled"),
      ),
    )
    .map((run) => `${run.id}:${run.updatedAt}`)
    .join("|");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const entry = await getCachedChapter(seriesId, chapterId);
        if (cancelled) return;
        setIsCached(entry?.state === "ready" || entry?.state === "partial");
      } catch {
        if (!cancelled) setIsCached(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chapterId, seriesId, cacheTerminalSignature]);

  const handleToggleChapterCache = useCallback(() => {
    if (!currentChapter) return;
    if (isUncaching) return;
    if (isCached || isCaching || isCacheQueued) {
      enqueueCacheRun({
        trigger: "reader",
        kind: "delete",
        scope: { sourceSeriesId: seriesId, reason: "single" },
        tasks: [
          {
            seriesId,
            sourceName: seriesSource ?? null,
            chapterId,
            chapterNo: currentChapter.chapterNo,
            chapterTitle: currentChapter.title,
            seriesTitle: seriesMeta?.title,
            seriesCoverUrl: seriesMeta?.coverUrl,
          },
        ],
      });
      setIsCached(false);
      return;
    }
    enqueueCacheRun({
      trigger: "reader",
      scope: { sourceSeriesId: seriesId, reason: "single" },
      tasks: [
        {
          seriesId,
          sourceName: seriesSource ?? null,
          chapterId,
          chapterNo: currentChapter.chapterNo,
          chapterTitle: currentChapter.title,
          seriesTitle: seriesMeta?.title,
          seriesCoverUrl: seriesMeta?.coverUrl,
        },
      ],
    });
  }, [currentChapter, isCached, isCaching, isCacheQueued, isUncaching, seriesId, seriesSource, chapterId, seriesMeta]);
  const isVertical = preferences.readingDirection === "vertical";
  const progressPercent =
    pages.length > 0 ? (Math.min(currentPage + 1, pages.length) / pages.length) * 100 : 0;
  const currentPageUrl = pages[currentPage]?.imageUrl ?? null;
  const currentPageLoaded = currentPageUrl ? Boolean(loadedPageUrls[currentPageUrl]) : false;
  const currentPageFailed = currentPageUrl ? Boolean(failedPageUrls[currentPageUrl]) : false;
  const verticalEagerPageUpperBound = getVerticalEagerPageUpperBound(currentPage, pages.length);

  const clearPreloadImage = useCallback((url: string) => {
    const image = preloadImageRefs.current.get(url);
    activePreloadUrlsRef.current.delete(url);
    // Also drop from the queued-URL memo so the preload effect can
    // re-enqueue this URL on the next run (important for retry).
    preloadedUrlsRef.current.delete(url);
    if (!image) {
      return;
    }

    image.onload = null;
    image.onerror = null;
    image.src = "";
    preloadImageRefs.current.delete(url);
  }, []);

  const markPageLoaded = useCallback((url: string) => {
    clearPreloadImage(url);
    setLoadedPageUrls((previous) => (
      previous[url]
        ? previous
        : { ...previous, [url]: true }
    ));
    setFailedPageUrls((previous) => {
      if (!previous[url]) {
        return previous;
      }

      const next = { ...previous };
      delete next[url];
      return next;
    });
  }, [clearPreloadImage]);

  const bumpRetryVersion = useCallback((url: string) => {
    setPageRetryVersions((previous) => ({
      ...previous,
      [url]: (previous[url] ?? 0) + 1,
    }));
  }, []);

  const retryPageLoad = useCallback((url: string) => {
    setFailedPageUrls((prev) => {
      if (!prev[url]) return prev;
      const next = { ...prev };
      delete next[url];
      return next;
    });
    // Force a re-fetch: bump the URL's retry version so <Image>
    // remounts and the preload effect re-enqueues the URL.
    bumpRetryVersion(url);
  }, [bumpRetryVersion]);

  const markPageFailed = useCallback((url: string) => {
    clearPreloadImage(url);
    // If a retry is already scheduled for this URL, don't stack more.
    if (retryTimerRefs.current.has(url)) {
      return;
    }
    const attempts = retryCountMapRef.current[url] ?? 0;
    if (attempts < MAX_RETRY_ATTEMPTS) {
      retryCountMapRef.current[url] = attempts + 1;
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempts);
      const timer = window.setTimeout(() => {
        retryTimerRefs.current.delete(url);
        // Bump retry version so the preload effect re-runs
        // and re-queues this URL (clearPreloadImage already
        // dropped it from preloadedUrlsRef).
        bumpRetryVersion(url);
      }, delay);
      retryTimerRefs.current.set(url, timer);
      return;
    }
    setFailedPageUrls((previous) => (
      previous[url]
        ? previous
        : { ...previous, [url]: true }
    ));
  }, [bumpRetryVersion, clearPreloadImage]);

  const stopAutoScroll = useCallback(() => {
    setAutoScrollEnabled(false);
  }, []);

  const resetZoom = useCallback(() => {
    setZoomLevel(1);
    zoomLevelRef.current = 1;
    setZoomOrigin({ x: 0, y: 0 });
  }, []);

  const toggleInfo = useCallback(() => {
    setShowInfo((v) => !v);
  }, []);

  const clearPendingProgressSave = useCallback(() => {
    if (saveTimeoutRef.current != null) {
      window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    saveAbortRef.current?.abort();
    saveAbortRef.current = null;
  }, []);

  const persistProgress = useCallback((
    options: {
      immediate?: boolean;
      keepalive?: boolean;
      currentPageOverride?: number;
      completedOverride?: boolean;
      scrollOffsetOverride?: number;
    } = {},
  ) => {
    if (!stateReady || pages.length === 0 || !currentChapter) {
      return;
    }

    clearPendingProgressSave();

    // If the intra-page restore hasn't landed yet, scrollRatioRef is 0 even
    // though the user's real position lives in pendingScrollRatioRef. Fall
    // back to the pending value so an auto-save can't overwrite the DB with
    // a stale 0 before layout settles.
    const effectiveRatio = options.scrollOffsetOverride
      ?? (pendingScrollRatioRef.current != null
        ? pendingScrollRatioRef.current
        : scrollRatioRef.current);
    const scrollOffset = clampScrollRatio(effectiveRatio);

    const requestBody = JSON.stringify({
      seriesId,
      source: seriesSource ?? undefined,
      chapterId,
      chapterTitle: currentChapter.title,
      chapterNo: currentChapter.chapterNo,
      pageCount: pages.length,
      currentPage: options.currentPageOverride ?? currentPage,
      scrollOffset,
      completed: options.completedOverride ?? currentPage >= pages.length - 1,
      updatedAt: new Date().toISOString(),
    });

    const chapterKey = makeCacheKey(seriesId, chapterId);

    const send = () => {
      saveTimeoutRef.current = null;

      // In offline mode (network down or user toggled it), skip the server
      // round-trip and queue the payload. The outbox flushes automatically
      // when the OfflineModeProvider sees us come back online.
      if (isOffline) {
        void enqueueProgress({ chapterKey, body: requestBody });
        return;
      }

      const request: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      };

      if (options.keepalive) {
        request.keepalive = true;
      } else {
        const controller = new AbortController();
        saveAbortRef.current = controller;
        request.signal = controller.signal;
      }

      void fetch("/api/reader/state", request)
        .then((res) => {
          if (res.ok) return;
          // 4xx means our payload is bad — retrying won't help. flushOutbox
          // drops 4xx anyway, so queuing would only flash the "N to sync"
          // pill until the next drain. Skip.
          if (res.status >= 400 && res.status < 500) return;
          // 5xx / other transient server failure — queue so the next flush
          // retries once the server recovers.
          void enqueueProgress({ chapterKey, body: requestBody });
        })
        .catch((error: unknown) => {
          // AbortError is deliberate — a newer save superseded this one, or
          // the reader unmounted. The superseding save (or chapter-complete
          // keepalive) carries the latest state, so queuing this stale
          // payload would leave a spurious "N to sync" pill online.
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
          // Fetch threw — almost always network failure. Persist locally so
          // the user doesn't silently lose reading progress.
          void enqueueProgress({ chapterKey, body: requestBody });
        });
    };

    if (options.immediate) {
      send();
      return;
    }

    saveTimeoutRef.current = window.setTimeout(send, 800);
  }, [chapterId, clearPendingProgressSave, currentChapter, currentPage, isOffline, pages.length, seriesId, seriesSource, stateReady]);

  const navigateToChapter = useCallback((
    nextChapterId: string,
    options: { completeCurrentChapter?: boolean } = {},
  ) => {
    const shouldCompleteChapter = options.completeCurrentChapter && pages.length > 0;
    const finalPage = Math.max(pages.length - 1, 0);

    persistProgress({
      immediate: true,
      keepalive: true,
      currentPageOverride: shouldCompleteChapter ? finalPage : undefined,
      completedOverride: shouldCompleteChapter ? true : undefined,
      scrollOffsetOverride: shouldCompleteChapter ? 1 : undefined,
    });

    router.push(buildReaderHref(seriesId, nextChapterId, seriesSource));
  }, [pages.length, persistProgress, router, seriesId, seriesSource]);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setLoading(true);
      setStateReady(false);
      restoreDoneRef.current = false;
      scrollRatioRef.current = 0;
      pendingScrollRatioRef.current = null;
      pageRefs.current = [];
      preloadedUrlsRef.current.clear();
      preloadImageRefs.current.forEach((image) => {
        image.onload = null;
        image.onerror = null;
      });
      preloadImageRefs.current.clear();
      preloadQueueRef.current = [];
      activePreloadUrlsRef.current.clear();
      setLoadedPageUrls({});
      setFailedPageUrls({});
      setPageRetryVersions({});
      retryCountMapRef.current = {};
      for (const timer of retryTimerRefs.current.values()) window.clearTimeout(timer);
      retryTimerRefs.current.clear();

      try {
        const chapterPageParams = new URLSearchParams({
          seriesId,
        });
        if (seriesSource) {
          chapterPageParams.set("source", seriesSource);
        }

        const [pagesRes, chaptersRes, stateRes, seriesInfoRes] = await Promise.all([
          fetch(`/api/chapters/${encodeURIComponent(chapterId)}/pages?${chapterPageParams.toString()}`),
          fetch(`/api/series/${encodeURIComponent(seriesId)}/chapters${seriesSource ? `?source=${encodeURIComponent(seriesSource)}` : ""}`),
          fetch(
            `/api/reader/state?seriesId=${encodeURIComponent(seriesId)}&chapterId=${encodeURIComponent(chapterId)}${seriesSource ? `&source=${encodeURIComponent(seriesSource)}` : ""}`,
          ),
          fetch(`/api/series/${encodeURIComponent(seriesId)}${seriesSource ? `?source=${encodeURIComponent(seriesSource)}` : ""}`),
        ]);

        if (isCancelled) return;

        const nextPages = pagesRes.ok ? ((await pagesRes.json()) as ChapterPage[]) : [];
        const nextChapters = chaptersRes.ok ? ((await chaptersRes.json()) as Chapter[]) : [];
        const lsDefaults = getLocalStorageDefaults();
        const nextState = stateRes.ok
          ? ((await stateRes.json()) as ReaderStateResponse)
          : {
            preferences: lsDefaults,
            progress: { currentPage: 0, completed: false, updatedAt: null },
          };
        // If the API returned default preferences (no per-series override), use localStorage defaults
        if (
          nextState.preferences.readingDirection === DEFAULT_PREFERENCES.readingDirection &&
          nextState.preferences.fitMode === DEFAULT_PREFERENCES.fitMode
        ) {
          nextState.preferences = lsDefaults;
        }

        if (seriesInfoRes.ok) {
          try {
            const info = (await seriesInfoRes.json()) as { title?: string; coverUrl?: string | null };
            setSeriesMeta({ title: info.title ?? seriesId, coverUrl: info.coverUrl ?? null });
          } catch { /* non-fatal */ }
        }
        setPages(nextPages);
        setChapters(nextChapters);
        setPreferences(nextState.preferences);
        const savedRatio = clampScrollRatio(nextState.progress.scrollOffset ?? 0);
        scrollRatioRef.current = savedRatio;
        pendingScrollRatioRef.current = savedRatio > 0 ? savedRatio : null;
        setCurrentPage(clampPage(nextState.progress.currentPage, nextPages.length || 1));
        setAutoScrollEnabled(false);
        setZoomLevel(1);
        zoomLevelRef.current = 1;
        setZoomOrigin({ x: 0, y: 0 });
        setStateReady(true);
      } catch {
        if (!isCancelled) {
          setPages([]);
          setChapters([]);
          setPreferences(getLocalStorageDefaults());
          setCurrentPage(0);
          setAutoScrollEnabled(false);
          setZoomLevel(1);
          zoomLevelRef.current = 1;
          setZoomOrigin({ x: 0, y: 0 });
          setStateReady(true);
        }
      } finally {
        if (!isCancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      isCancelled = true;
    };
  }, [chapterId, seriesId, seriesSource]);

  useEffect(() => {
    const saved = window.localStorage.getItem(PROGRESS_BAR_KEY);
    if (saved === "0") setShowProgressBar(false);
    if (saved === "1") setShowProgressBar(true);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(PRELOAD_STORAGE_KEY);
    const parsed = saved ? Number.parseInt(saved, 10) : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= 0) {
      setPreloadWindow(Math.min(parsed, 25));
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PRELOAD_STORAGE_KEY, String(preloadWindow));
  }, [preloadWindow]);

  useEffect(() => {
    window.localStorage.setItem(AUTOSCROLL_SPEED_KEY, String(autoScrollSpeed));
  }, [autoScrollSpeed]);

  // Listen for storage changes from Manage page
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === PROGRESS_BAR_KEY) {
        setShowProgressBar(e.newValue !== "0");
      }
      if (e.key === PRELOAD_STORAGE_KEY) {
        const parsed = e.newValue ? Number.parseInt(e.newValue, 10) : Number.NaN;
        if (Number.isFinite(parsed) && parsed >= 0) {
          setPreloadWindow(Math.min(parsed, 25));
        }
      }
      if (e.key === AUTOSCROLL_SPEED_KEY) {
        const parsed = e.newValue ? Number.parseFloat(e.newValue) : Number.NaN;
        if (Number.isFinite(parsed)) {
          setAutoScrollSpeed(normalizeAutoscrollSpeed(parsed));
        }
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (isVertical) return;
    stopAutoScroll();
  }, [isVertical, stopAutoScroll]);

  // Autoscroll — uses scrollBy with behavior:"instant" for butter-smooth 120fps
  // Matches the proven approach from da8e8e7
  useEffect(() => {
    if (!isVertical || !autoScrollEnabled || pages.length === 0 || showInfo) {
      autoScrollLastTsRef.current = null;
      if (autoScrollRafRef.current != null) {
        window.cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
      return;
    }

    autoScrollLastTsRef.current = null;

    const step = (timestamp: number) => {
      const lastTs = autoScrollLastTsRef.current;
      autoScrollLastTsRef.current = timestamp;

      if (lastTs != null) {
        const deltaSeconds = (timestamp - lastTs) / 1000;
        const distance = autoScrollSpeed * deltaSeconds;

        window.scrollBy({ top: distance, behavior: "instant" });

        const maxScrollTop = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
        if (window.scrollY >= maxScrollTop - 1) {
          setAutoScrollEnabled(false);
          autoScrollRafRef.current = null;
          return;
        }
      }

      autoScrollRafRef.current = window.requestAnimationFrame(step);
    };

    autoScrollRafRef.current = window.requestAnimationFrame(step);

    return () => {
      autoScrollLastTsRef.current = null;
      if (autoScrollRafRef.current != null) {
        window.cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
  }, [autoScrollEnabled, autoScrollSpeed, isVertical, pages.length, showInfo]);

  useEffect(() => {
    if (!autoScrollEnabled) {
      return;
    }

    const handleManualInterrupt = () => stopAutoScroll();
    window.addEventListener("wheel", handleManualInterrupt, { passive: true });
    window.addEventListener("touchmove", handleManualInterrupt, { passive: true });

    return () => {
      window.removeEventListener("wheel", handleManualInterrupt);
      window.removeEventListener("touchmove", handleManualInterrupt);
    };
  }, [autoScrollEnabled, stopAutoScroll]);

  useEffect(() => {
    if (!stateReady) return;
    if (!preferencesLoadedRef.current) {
      preferencesLoadedRef.current = true;
      return;
    }

    const controller = new AbortController();
    void fetch("/api/reader/state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seriesId,
        source: seriesSource ?? undefined,
        readingDirection: preferences.readingDirection,
        fitMode: preferences.fitMode,
      }),
      signal: controller.signal,
    }).catch(() => { });

    return () => controller.abort();
  }, [preferences, seriesId, seriesSource, stateReady]);

  useEffect(() => {
    if (!stateReady || pages.length === 0) return;

    const clampedPage = clampPage(currentPage, pages.length);
    if (clampedPage !== currentPage) {
      setCurrentPage(clampedPage);
      return;
    }

    if (!restoreDoneRef.current) {
      restoreDoneRef.current = true;
      if (isVertical) {
        const target = pageRefs.current[clampedPage];
        if (target) target.scrollIntoView({ block: "start" });
        else window.scrollTo({ top: 0 });
        // Intra-page offset (if any) is applied by the effect below once
        // the target page's image has loaded and the layout has settled.
      } else {
        window.scrollTo({ top: 0 });
        pendingScrollRatioRef.current = null;
      }
      return;
    }

    if (!isVertical) window.scrollTo({ top: 0 });
  }, [currentPage, isVertical, pages.length, stateReady]);

  // Apply the saved intra-page ratio once the target page's image has loaded.
  // Rendering at real intrinsic height can shift layout significantly vs. the
  // placeholder aspect-ratio, so waiting avoids landing at the wrong spot.
  useEffect(() => {
    if (!stateReady || !isVertical || pages.length === 0) return;
    const ratio = pendingScrollRatioRef.current;
    if (ratio == null) return;
    const pageIndex = clampPage(currentPage, pages.length);
    const page = pages[pageIndex];
    if (!page) return;
    if (!loadedPageUrls[page.imageUrl]) return;
    const target = pageRefs.current[pageIndex];
    if (!target) return;

    pendingScrollRatioRef.current = null;

    const applyOffset = () => {
      const el = pageRefs.current[pageIndex];
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.height > 0 && ratio > 0) {
        const absoluteTop = rect.top + window.scrollY;
        window.scrollTo({ top: absoluteTop + rect.height * ratio });
      }
      scrollRatioRef.current = ratio;
    };

    // Defer one frame so browser flush after image load/layout is visible.
    const frame = window.requestAnimationFrame(applyOffset);
    return () => window.cancelAnimationFrame(frame);
  }, [currentPage, isVertical, loadedPageUrls, pages, stateReady]);

  useEffect(() => {
    if (!isVertical || !stateReady || pages.length === 0) return;

    let ticking = false;

    const updateCurrentPage = () => {
      scrollUpdateRafRef.current = null;
      ticking = false;
      const viewportCenter = window.innerHeight / 2;
      let closestIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;
      let closestRect: DOMRect | null = null;

      pageRefs.current.forEach((element, index) => {
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const midPoint = rect.top + rect.height / 2;
        const distance = Math.abs(midPoint - viewportCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
          closestRect = rect;
        }
      });

      // Don't touch scrollRatioRef until pending restoration lands, otherwise
      // we'd save "top of page" (ratio 0) over the user's real position.
      if (closestRect && pendingScrollRatioRef.current == null) {
        const rect: DOMRect = closestRect;
        scrollRatioRef.current = rect.height > 0
          ? clampScrollRatio(-rect.top / rect.height)
          : 0;
      }

      setCurrentPage((prev) => (prev === closestIndex ? prev : closestIndex));
    };

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      scrollUpdateRafRef.current = window.requestAnimationFrame(updateCurrentPage);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    handleScroll();

    return () => {
      if (scrollUpdateRafRef.current != null) {
        window.cancelAnimationFrame(scrollUpdateRafRef.current);
        scrollUpdateRafRef.current = null;
      }
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [isVertical, pages.length, stateReady]);

  useEffect(() => {
    if (!stateReady || pages.length === 0 || !currentChapter) return;
    persistProgress();
  }, [currentChapter, pages.length, persistProgress, stateReady]);

  useEffect(() => () => {
    clearPendingProgressSave();
    // Clear retry timers on unmount to prevent state updates on unmounted component
    for (const timer of retryTimerRefs.current.values()) window.clearTimeout(timer);
    retryTimerRefs.current.clear();
  }, [clearPendingProgressSave]);

  // Keep processPreloadQueueRef current so the recursive callback always uses latest marks
  useEffect(() => {
    processPreloadQueueRef.current = () => {
      const maxConcurrentPreloads = getMaxConcurrentPreloads(preloadWindow);
      while (
        activePreloadUrlsRef.current.size < maxConcurrentPreloads &&
        preloadQueueRef.current.length > 0
      ) {
        const url = preloadQueueRef.current.shift()!;
        const image = new window.Image();
        const pageIndex = pages.findIndex((page) => page.imageUrl === url);
        const distance = pageIndex >= 0 ? pageIndex - currentPage : preloadWindow;
        activePreloadUrlsRef.current.add(url);
        image.fetchPriority = getFetchPriorityForDistance(distance, preloadWindow);
        image.onload = () => {
          markPageLoaded(url);
          processPreloadQueueRef.current();
        };
        image.onerror = () => {
          markPageFailed(url);
          processPreloadQueueRef.current();
        };
        preloadImageRefs.current.set(url, image);
        image.src = url;
      }
    };
  }, [currentPage, markPageFailed, markPageLoaded, pages, preloadWindow]);

  // Dynamic preload pool: prioritize nearer pages, cap lookahead, cancel stale work when the reader jumps.
  useEffect(() => {
    if (pages.length === 0 || preloadWindow <= 0) {
      preloadQueueRef.current = [];
      preloadedUrlsRef.current.clear();
      for (const url of preloadImageRefs.current.keys()) {
        clearPreloadImage(url);
      }
      return;
    }
    const maxIndex = Math.min(currentPage + preloadWindow * PRELOAD_MULTIPLIER, pages.length - 1);
    const firstPreloadIndex = isVertical ? verticalEagerPageUpperBound + 1 : currentPage + 1;
    const nextUrls: string[] = [];
    for (let index = firstPreloadIndex; index <= maxIndex; index += 1) {
      const page = pages[index];
      if (!page) continue;
      nextUrls.push(page.imageUrl);
    }

    const nextUrlSet = new Set(nextUrls);

    for (const url of preloadQueueRef.current) {
      if (!nextUrlSet.has(url)) {
        preloadedUrlsRef.current.delete(url);
      }
    }
    preloadQueueRef.current = preloadQueueRef.current.filter((url) => nextUrlSet.has(url));

    for (const url of preloadImageRefs.current.keys()) {
      if (!nextUrlSet.has(url) && !loadedPageUrls[url]) {
        clearPreloadImage(url);
        preloadedUrlsRef.current.delete(url);
      }
    }

    // Warm the cache in two phases: let the current page finish first so it
    // gets uncontested bandwidth and primes upstream session state, then fire
    // the parallel preload pool. We re-run this effect when loadedPageUrls or
    // failedPageUrls update, so the pool kicks off as soon as the gate opens.
    // Stale work above still gets cancelled regardless — only new enqueues wait.
    if (currentPageUrl && !currentPageLoaded && !currentPageFailed) {
      return;
    }

    for (const url of nextUrls) {
      if (
        loadedPageUrls[url] ||
        failedPageUrls[url] ||
        preloadImageRefs.current.has(url) ||
        preloadedUrlsRef.current.has(url)
      ) {
        continue;
      }
      preloadedUrlsRef.current.add(url);
      preloadQueueRef.current.push(url);
    }

    processPreloadQueueRef.current();
  }, [
    clearPreloadImage,
    currentPage,
    currentPageFailed,
    currentPageLoaded,
    currentPageUrl,
    failedPageUrls,
    isVertical,
    loadedPageUrls,
    pageRetryVersions,
    pages,
    preloadWindow,
    verticalEagerPageUpperBound,
  ]);

  // Track preload progress
  useEffect(() => {
    if (pages.length === 0 || preloadWindow <= 0) {
      setPreloadProgress({ loaded: 0, total: 0 });
      return;
    }
    const maxIndex = Math.min(currentPage + preloadWindow * PRELOAD_MULTIPLIER, pages.length - 1);
    const firstIdx = isVertical ? verticalEagerPageUpperBound + 1 : currentPage + 1;
    let total = 0;
    let loaded = 0;
    for (let i = firstIdx; i <= maxIndex; i++) {
      const p = pages[i];
      if (!p) continue;
      total++;
      if (loadedPageUrls[p.imageUrl]) loaded++;
    }
    setPreloadProgress({ loaded, total });
  }, [currentPage, isVertical, loadedPageUrls, pages, preloadWindow, verticalEagerPageUpperBound]);

  // Pinch-to-zoom and pan for paged mode
  useEffect(() => {
    const container = zoomContainerRef.current;
    if (!container || isVertical) return;

    function handleTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        e.preventDefault();
        const state = touchStateRef.current;
        state.isPinching = true;
        state.isPanning = false;
        state.initialDistance = getTouchDistance(e.touches);
        state.initialZoom = zoomLevelRef.current;
        const center = getTouchCenter(e.touches);
        state.lastX = center.x;
        state.lastY = center.y;
      } else if (e.touches.length === 1 && zoomLevelRef.current > 1) {
        const state = touchStateRef.current;
        state.isPanning = true;
        state.lastX = e.touches[0].clientX;
        state.lastY = e.touches[0].clientY;
      }
    }

    function handleTouchMove(e: TouchEvent) {
      const state = touchStateRef.current;
      if (e.touches.length === 2 && state.isPinching) {
        e.preventDefault();
        const distance = getTouchDistance(e.touches);
        const scale = Math.min(Math.max(state.initialZoom * (distance / state.initialDistance), 1), 5);
        zoomLevelRef.current = scale;
        setZoomLevel(scale);

        if (scale > 1) {
          const center = getTouchCenter(e.touches);
          const dx = center.x - state.lastX;
          const dy = center.y - state.lastY;
          state.lastX = center.x;
          state.lastY = center.y;
          setZoomOrigin(prev => ({ x: prev.x + dx, y: prev.y + dy }));
        }
      } else if (e.touches.length === 1 && state.isPanning && zoomLevelRef.current > 1) {
        e.preventDefault();
        const touch = e.touches[0];
        const dx = touch.clientX - state.lastX;
        const dy = touch.clientY - state.lastY;
        state.lastX = touch.clientX;
        state.lastY = touch.clientY;
        setZoomOrigin(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      }
    }

    function handleTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) {
        touchStateRef.current.isPinching = false;
      }
      if (e.touches.length === 0) {
        touchStateRef.current.isPanning = false;
      }
    }

    container.addEventListener("touchstart", handleTouchStart, { passive: false });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd);

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isVertical]);

  const goToPreviousPage = useCallback(() => {
    resetZoom();
    if (currentPage > 0) {
      setCurrentPage((v) => Math.max(v - 1, 0));
      return;
    }
    if (prevChapter) navigateToChapter(prevChapter.sourceChapterId);
  }, [currentPage, navigateToChapter, prevChapter, resetZoom]);

  const goToNextPage = useCallback(() => {
    resetZoom();
    if (currentPage < pages.length - 1) {
      setCurrentPage((v) => Math.min(v + 1, pages.length - 1));
      return;
    }
    if (nextChapter) {
      navigateToChapter(nextChapter.sourceChapterId, { completeCurrentChapter: true });
    }
  }, [currentPage, navigateToChapter, nextChapter, pages.length, resetZoom]);

  const adjustAutoScrollSpeed = useCallback((direction: -1 | 1) => {
    setAutoScrollSpeed((prev) => {
      const current = normalizeAutoscrollSpeed(prev);
      const currentIndex = AUTOSCROLL_SPEED_OPTIONS.indexOf(current);
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = Math.min(
        Math.max(baseIndex + direction, 0),
        AUTOSCROLL_SPEED_OPTIONS.length - 1,
      );
      return AUTOSCROLL_SPEED_OPTIONS[nextIndex];
    });
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;

      // Escape closes whichever overlay is open, in a priority order
      // that matches the visual stack. Cheap a11y win: users can dismiss
      // settings/info with a keyboard instead of hunting for the X.
      if (event.key === "Escape") {
        if (showSettings) { event.preventDefault(); setShowSettings(false); return; }
        if (showInfo)     { event.preventDefault(); setShowInfo(false);     return; }
      }

      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        setPreferences((v) => ({
          ...v,
          readingDirection: nextReadingDirection(v.readingDirection),
        }));
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setPreferences((v) => ({ ...v, fitMode: nextFitMode(v.fitMode) }));
        return;
      }

      if (event.key.toLowerCase() === "a") {
        if (isVertical && pages.length > 0) {
          event.preventDefault();
          setAutoScrollEnabled((v) => !v);
        }
        return;
      }

      if (event.key === " " || event.code === "Space" || event.key === "Spacebar") {
        if (isVertical && pages.length > 0) {
          event.preventDefault();
          setAutoScrollEnabled((v) => !v);
        }
        return;
      }

      if (event.key === "-" || event.key === "_") {
        if (isVertical) {
          event.preventDefault();
          adjustAutoScrollSpeed(-1);
        }
        return;
      }

      if (event.key === "=" || event.key === "+") {
        if (isVertical) {
          event.preventDefault();
          adjustAutoScrollSpeed(1);
        }
        return;
      }

      if (event.key === "h" || event.key === "H") {
        event.preventDefault();
        router.push("/");
        return;
      }

      if (event.key === "0") {
        event.preventDefault();
        resetZoom();
        return;
      }

      if (event.key === "[") {
        event.preventDefault();
        if (prevChapter) navigateToChapter(prevChapter.sourceChapterId);
        return;
      }

      if (event.key === "]") {
        event.preventDefault();
        if (nextChapter) navigateToChapter(nextChapter.sourceChapterId);
        return;
      }

      if (pages.length === 0) return;

      if (isVertical) {
        if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
          event.preventDefault();
          if (autoScrollEnabled) stopAutoScroll();
          window.scrollBy({ top: window.innerHeight * 0.85, behavior: "smooth" });
        }
        if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
          event.preventDefault();
          if (autoScrollEnabled) stopAutoScroll();
          window.scrollBy({ top: -window.innerHeight * 0.85, behavior: "smooth" });
        }
        if (event.key === "ArrowLeft" && prevChapter) {
          event.preventDefault();
          navigateToChapter(prevChapter.sourceChapterId);
        }
        if (event.key === "ArrowRight" && nextChapter) {
          event.preventDefault();
          navigateToChapter(nextChapter.sourceChapterId);
        }
        return;
      }

      if (preferences.readingDirection === "rtl") {
        if (event.key === "ArrowLeft" || event.key.toLowerCase() === "j") {
          event.preventDefault();
          goToNextPage();
        }
        if (event.key === "ArrowRight" || event.key.toLowerCase() === "k") {
          event.preventDefault();
          goToPreviousPage();
        }
      } else {
        if (event.key === "ArrowLeft" || event.key.toLowerCase() === "k") {
          event.preventDefault();
          goToPreviousPage();
        }
        if (event.key === "ArrowRight" || event.key.toLowerCase() === "j") {
          event.preventDefault();
          goToNextPage();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    currentPage,
    adjustAutoScrollSpeed,
    goToNextPage,
    goToPreviousPage,
    autoScrollEnabled,
    isVertical,
    navigateToChapter,
    nextChapter,
    pages.length,
    preferences.readingDirection,
    prevChapter,
    resetZoom,
    router,
    stopAutoScroll,
    showSettings,
    showInfo,
  ]);

  function handleChapterTransition() {
    if (nextChapter) {
      navigateToChapter(nextChapter.sourceChapterId, { completeCurrentChapter: true });
    }
  }

  // Vertical click: single tap = toggle info, double tap = toggle autoscroll
  function handleVerticalClick() {
    const now = Date.now();
    const elapsed = now - lastTapTimeRef.current;
    lastTapTimeRef.current = now;

    if (elapsed < DOUBLE_TAP_DELAY_MS && isVertical && pages.length > 0) {
      // Double tap — cancel pending single tap, toggle autoscroll
      if (singleTapTimerRef.current != null) {
        window.clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapTimeRef.current = 0;
      setAutoScrollEnabled((v) => !v);
      return;
    }

    // Delay single tap action so double-tap can cancel it
    singleTapTimerRef.current = window.setTimeout(() => {
      singleTapTimerRef.current = null;
      toggleInfo();
    }, DOUBLE_TAP_DELAY_MS);
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-void px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-faint">
          Loading chapter
        </p>
        <div
          className="progress-indeterminate h-0.5 w-full max-w-xs rounded-full"
          role="progressbar"
          aria-label="Loading chapter"
        />
      </div>
    );
  }

  const pagedImageClassName = cn(
    "mx-auto select-none object-contain",
    preferences.fitMode === "width" && "h-auto w-full",
    preferences.fitMode === "height" && "h-[calc(100dvh-4rem)] w-auto max-w-full",
    preferences.fitMode === "original" && "h-auto w-auto max-w-full",
  );

  return (
    <div className="relative min-h-dvh bg-void text-text">
      {showProgressBar && (
        <div
          className="fixed inset-x-0 top-0 z-[70] h-0.5 bg-border-subtle"
          aria-label="Reading progress bar"
        >
          <div
            className="h-full bg-accent transition-[width] duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* Top bar */}
      <div
        className={cn(
          "fixed inset-x-0 top-0 z-[80] border-b border-border-subtle bg-void transition-transform duration-200",
          showInfo ? "translate-y-0" : "-translate-y-full",
        )}
      >
        <div style={{ paddingTop: "env(safe-area-inset-top)" }} />
        <div className="flex h-11 items-center justify-between px-4" onClick={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
          {prevChapter ? (
            <button
              onClick={() => navigateToChapter(prevChapter.sourceChapterId)}
              className="flex items-center gap-1.5 p-1.5 text-sm text-text-muted transition-colors hover:text-text"
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </button>
          ) : (
            <div className="w-16" />
          )}
          <div className="flex items-center gap-2">
            <p className="font-mono text-sm text-text-muted">
              {`${Math.min(currentPage + 1, Math.max(pages.length, 1))} / ${pages.length || 1}`}
            </p>
            {preloadProgress.total > 0 && preloadProgress.loaded < preloadProgress.total && (
              <span className="font-mono text-[10px] text-text-faint" title="Pages preloaded ahead">
                ({preloadProgress.loaded}/{preloadProgress.total})
              </span>
            )}
            {zoomLevel > 1 && (
              <button onClick={resetZoom} className="p-1.5 text-xs text-accent">
                {Math.round(zoomLevel * 100)}% ✕
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            {nextChapter ? (
              <button
                onClick={() => navigateToChapter(nextChapter.sourceChapterId)}
                className="flex items-center gap-1.5 p-1.5 text-sm text-accent transition-colors hover:text-accent-muted"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <Link
                href={buildSeriesHref(seriesId, seriesSource)}
                className="flex items-center gap-1.5 p-1.5 text-sm text-text-muted transition-colors hover:text-text"
              >
                Series
                <ChevronRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-[80] border-t border-border-subtle bg-void transition-transform duration-200",
          showInfo ? "translate-y-0" : "translate-y-full",
        )}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
      >
        <div className="relative flex h-11 items-center justify-center px-4" onClick={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
          <Link
            href={buildSeriesHref(seriesId, seriesSource)}
            className="absolute left-4 shrink-0 p-1.5 text-text-muted transition-colors hover:text-accent"
            aria-label="Back to series"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <select
            value={chapterId}
            onChange={(e) => {
              navigateToChapter(e.target.value);
              setShowInfo(false);
            }}
            className="cursor-pointer appearance-none bg-transparent text-center text-sm text-text focus:outline-none"
          >
            {chapters.map((ch) => (
              <option key={ch.sourceChapterId} value={ch.sourceChapterId}>
                {ch.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => { settingsOpenedAtRef.current = Date.now(); setShowSettings(true); }}
            className="absolute right-4 shrink-0 p-1.5 text-text-muted transition-colors hover:text-accent"
            aria-label="Reader settings"
          >
            <Settings2 className="h-5 w-5" />
          </button>
        </div>
        {!isVertical && pages.length > 1 && (
          <div className="px-4 pb-2">
            <input
              type="range"
              min={0}
              max={pages.length - 1}
              value={currentPage}
              onChange={(e) => setCurrentPage(Number(e.target.value))}
              className="w-full accent-accent"
              aria-label="Page scrubber"
            />
          </div>
        )}
      </div>

      {/* Settings modal */}
      {showSettings && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-void/60 backdrop-blur-sm sm:items-center"
          onClick={(e) => { if (e.target === e.currentTarget && Date.now() - settingsOpenedAtRef.current > 400) setShowSettings(false); }}
        >
          <div className="w-full max-w-sm rounded-t-lg border border-border-subtle bg-surface sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <h3 className="text-sm font-medium text-text">Reader settings</h3>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                aria-label="Close reader settings"
                className="p-1 text-text-faint transition-colors hover:text-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-4 py-4">
              {/* Reading direction */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase tracking-widest text-text-faint">Direction</label>
                <div className="flex gap-1">
                  {(["vertical", "ltr", "rtl"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setPreferences((v) => ({ ...v, readingDirection: d }))}
                      className={cn(
                        "flex-1 rounded-sm border px-2 py-1.5 text-xs transition-colors",
                        preferences.readingDirection === d
                          ? "border-accent bg-accent-faint text-accent"
                          : "border-border text-text-faint hover:text-text-muted",
                      )}
                    >
                      {DIRECTION_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fit mode */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-medium uppercase tracking-widest text-text-faint">Fit mode</label>
                <div className="flex gap-1">
                  {(["width", "height", "original"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setPreferences((v) => ({ ...v, fitMode: f }))}
                      className={cn(
                        "flex-1 rounded-sm border px-2 py-1.5 text-xs transition-colors",
                        preferences.fitMode === f
                          ? "border-accent bg-accent-faint text-accent"
                          : "border-border text-text-faint hover:text-text-muted",
                      )}
                    >
                      {FIT_LABELS[f]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Autoscroll (vertical only) */}
              {isVertical && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium uppercase tracking-widest text-text-faint">Autoscroll</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAutoScrollEnabled((v) => !v)}
                      className={cn(
                        "rounded-sm border px-3 py-1.5 text-xs font-medium transition-colors",
                        autoScrollEnabled
                          ? "border-accent bg-accent-faint text-accent"
                          : "border-border text-text-faint hover:text-text-muted",
                      )}
                    >
                      {autoScrollEnabled ? "On" : "Off"}
                    </button>
                    <button
                      type="button"
                      onClick={() => adjustAutoScrollSpeed(-1)}
                      className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-xs text-text-muted transition-colors hover:text-text"
                    >
                      −
                    </button>
                    <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-text-muted">
                      {autoScrollSpeed} px/s
                    </span>
                    <button
                      type="button"
                      onClick={() => adjustAutoScrollSpeed(1)}
                      className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-xs text-text-muted transition-colors hover:text-text"
                    >
                      +
                    </button>
                  </div>
                  <p className="text-[10px] text-text-faint">Double-tap to toggle · Space / A on keyboard</p>
                </div>
              )}

              {/* Progress bar */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">Progress bar</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showProgressBar}
                  onClick={() => {
                    setShowProgressBar((v) => {
                      window.localStorage.setItem(PROGRESS_BAR_KEY, !v ? "1" : "0");
                      return !v;
                    });
                  }}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-200",
                    showProgressBar ? "bg-accent" : "bg-border",
                  )}
                >
                  <span
                    className={cn(
                      "h-4 w-4 rounded-full bg-text shadow-sm transition-transform duration-200",
                      showProgressBar ? "translate-x-4" : "translate-x-0",
                    )}
                  />
                </button>
              </div>

              {/* Preload window */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">Preload pages</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPreloadWindow((v) => Math.max(0, v - 1))}
                    className="flex h-6 w-6 items-center justify-center rounded-sm border border-border text-xs text-text-muted hover:text-text"
                  >
                    −
                  </button>
                  <span className="min-w-[1.5rem] text-center text-xs tabular-nums text-text-muted">{preloadWindow}</span>
                  <button
                    type="button"
                    onClick={() => setPreloadWindow((v) => Math.min(25, v + 1))}
                    className="flex h-6 w-6 items-center justify-center rounded-sm border border-border text-xs text-text-muted hover:text-text"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Cache chapter on device */}
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs text-text-muted">Cache on device</span>
                  <span className="text-[10px] text-text-faint">
                    {isCaching
                      ? "Caching…"
                      : isCacheQueued
                        ? "Queued"
                        : isUncaching
                          ? "Removing…"
                          : isCached
                            ? "Saved for offline"
                            : "Tap to save for offline"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleToggleChapterCache}
                  disabled={!currentChapter || isUncaching}
                  className={cn(
                    "flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    isCached || isCaching || isCacheQueued
                      ? "border-accent bg-accent-faint text-accent"
                      : "border-border text-text-muted hover:text-text",
                    (!currentChapter || isUncaching) && "opacity-50",
                  )}
                  aria-pressed={isCached}
                >
                  <HardDrive
                    className={cn(
                      "h-3.5 w-3.5",
                      (isCaching || isCacheQueued || isUncaching) && "animate-pulse",
                    )}
                  />
                  {isCached || isCaching || isCacheQueued ? "Cached" : "Cache"}
                </button>
              </div>
            </div>

            {/* Keyboard shortcuts hint */}
            <div className="border-t border-border-subtle px-4 py-2.5">
              <p className="text-center font-mono text-[10px] text-text-faint">
                M direction · F fit · A / Space autoscroll · −/+ speed · ? help
              </p>
            </div>
          </div>
        </div>
      )}

      {isVertical ? (
        <div
          className="mx-auto max-w-5xl"
          onClick={handleVerticalClick}
        >
          {pages.map((page) => {
            const pageLoaded = Boolean(loadedPageUrls[page.imageUrl]);
            const pageFailed = Boolean(failedPageUrls[page.imageUrl]);
            return (
              <div
                key={page.index}
                ref={(el) => {
                  pageRefs.current[page.index] = el;
                }}
                className="relative w-full bg-void"
              >
                {!pageLoaded && !pageFailed && (
                  <div className="absolute inset-0 flex min-h-[40dvh] flex-col items-center justify-center gap-3 bg-void px-6">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-faint">
                      Page {page.index + 1}
                    </span>
                    <div
                      className="progress-indeterminate h-0.5 w-full max-w-[12rem] rounded-full"
                      role="progressbar"
                      aria-label={`Loading page ${page.index + 1}`}
                    />
                  </div>
                )}
                {pageFailed && (
                  <div className="absolute inset-0 flex min-h-[40dvh] flex-col items-center justify-center gap-2 bg-void px-4">
                    <p className="text-center text-sm text-text-muted">Page failed to load after {MAX_RETRY_ATTEMPTS} retries.</p>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); delete retryCountMapRef.current[page.imageUrl]; retryPageLoad(page.imageUrl); }}
                      className="rounded-sm border border-border px-3 py-1.5 text-xs text-accent transition-colors hover:border-accent"
                    >
                      Retry
                    </button>
                  </div>
                )}
                <Image
                  key={`${page.imageUrl}-v${pageRetryVersions[page.imageUrl] ?? 0}`}
                  src={page.imageUrl}
                  alt={`Page ${page.index + 1}`}
                  width={1400}
                  height={2000}
                  sizes="100vw"
                  className={cn(
                    "mx-auto h-auto select-none",
                    preferences.fitMode === "width" && "w-full",
                    preferences.fitMode === "height" && "max-h-dvh w-auto",
                    preferences.fitMode === "original" && "w-auto max-w-full",
                    !pageLoaded && "opacity-0",
                  )}
                  loading={page.index <= verticalEagerPageUpperBound ? "eager" : "lazy"}
                  fetchPriority={getFetchPriorityForDistance(page.index - currentPage, preloadWindow)}
                  onError={() => markPageFailed(page.imageUrl)}
                  onLoad={() => markPageLoaded(page.imageUrl)}
                  priority={
                    page.index >= currentPage
                    && page.index <= Math.min(verticalEagerPageUpperBound, currentPage + 2)
                  }
                  unoptimized
                />
              </div>
            );
          })}

          {nextChapter && pages.length > 0 && (
            <ChapterTransition
              completedTitle={currentChapter?.title ?? "Chapter"}
              nextTitle={nextChapter.title}
              onAdvance={handleChapterTransition}
            />
          )}

          {!nextChapter && pages.length > 0 && (
            <div className="flex flex-col items-center gap-3 py-16">
              <p className="font-display text-lg italic text-text-muted">
                You&rsquo;ve reached the latest chapter
              </p>
              <Link
                href={buildSeriesHref(seriesId, seriesSource)}
                className="text-xs text-accent transition-colors hover:text-accent-muted"
              >
                Back to series
              </Link>
            </div>
          )}
        </div>
      ) : pages.length > 0 ? (
        <div className="relative flex min-h-dvh items-center justify-center">
          {zoomLevel <= 1 && (
            <>
              <button
                onClick={preferences.readingDirection === "rtl" ? goToNextPage : goToPreviousPage}
                className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-w-resize focus:outline-none"
                aria-label="Previous page"
              />
              <button
                onClick={toggleInfo}
                className="absolute inset-y-0 left-1/3 z-10 w-1/3 cursor-pointer focus:outline-none"
                aria-label="Show chapter info"
              />
              <button
                onClick={preferences.readingDirection === "rtl" ? goToPreviousPage : goToNextPage}
                className="absolute inset-y-0 right-0 z-10 w-1/3 cursor-e-resize focus:outline-none"
                aria-label="Next page"
              />
            </>
          )}

          <div
            ref={zoomContainerRef}
            className="flex min-h-[85dvh] items-center justify-center px-4"
            style={zoomLevel > 1 ? {
              transform: `scale(${zoomLevel}) translate(${zoomOrigin.x / zoomLevel}px, ${zoomOrigin.y / zoomLevel}px)`,
              transformOrigin: "center center",
            } : undefined}
          >
            {!currentPageLoaded && !currentPageFailed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-void px-6">
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-faint">
                  Page {currentPage + 1} / {pages.length}
                </span>
                <div
                  className="progress-indeterminate h-0.5 w-full max-w-[14rem] rounded-full"
                  role="progressbar"
                  aria-label={`Loading page ${currentPage + 1}`}
                />
              </div>
            )}
            {currentPageFailed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-void px-4">
                <p className="text-center text-sm text-text-muted">Page failed to load after {MAX_RETRY_ATTEMPTS} retries.</p>
                <button
                  type="button"
                  onClick={() => { if (currentPageUrl) { delete retryCountMapRef.current[currentPageUrl]; retryPageLoad(currentPageUrl); } }}
                  className="rounded-sm border border-border px-3 py-1.5 text-xs text-accent transition-colors hover:border-accent"
                >
                  Retry
                </button>
              </div>
            )}
            <Image
              key={`${chapterId}-${currentPage}-v${pageRetryVersions[currentPageUrl ?? ""] ?? 0}`}
              src={pages[currentPage]?.imageUrl ?? ""}
              alt={`Page ${currentPage + 1}`}
              width={1400}
              height={2000}
              className={cn(pagedImageClassName, !currentPageLoaded && "opacity-0")}
              fetchPriority="high"
              onError={() => {
                if (currentPageUrl) {
                  markPageFailed(currentPageUrl);
                }
              }}
              onLoad={() => {
                if (currentPageUrl) {
                  markPageLoaded(currentPageUrl);
                }
              }}
              unoptimized
            />
          </div>

          <div className="pointer-events-none fixed inset-y-0 left-0 z-20 hidden w-12 items-center justify-center md:flex">
            <ChevronLeft className="h-5 w-5 text-text-faint/30" />
          </div>
          <div className="pointer-events-none fixed inset-y-0 right-0 z-20 hidden w-12 items-center justify-center md:flex">
            <ChevronRight className="h-5 w-5 text-text-faint/30" />
          </div>
        </div>
      ) : (
        <div className="flex min-h-dvh items-center justify-center">
          <p className="text-sm text-text-faint">No pages available.</p>
        </div>
      )}

      {!isVertical && pages.length > 0 && (
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 text-sm">
          {prevChapter ? (
            <button
              onClick={() => navigateToChapter(prevChapter.sourceChapterId)}
              className="flex items-center gap-1.5 rounded-sm border border-border px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>
          ) : (
            <div />
          )}

          <p className="font-mono text-[10px] text-text-faint">
            [ ] chapter &middot; M mode &middot; F fit &middot; H home
          </p>

          {nextChapter ? (
            <button
              onClick={() => navigateToChapter(nextChapter.sourceChapterId)}
              className="flex items-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-xs font-medium text-void transition-colors hover:bg-accent-muted"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Link
              href={buildSeriesHref(seriesId, seriesSource)}
              className="rounded-sm bg-accent px-3 py-2 text-xs font-medium text-void transition-colors hover:bg-accent-muted"
            >
              Series
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
