"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
const AUTOSCROLL_EAGER_MULTIPLIER = 4;
const AUTOSCROLL_EAGER_MIN_LOOKAHEAD = 24;
const AUTOSCROLL_PAUSE_LOOKAHEAD_VIEWPORTS = 1.5;
const AUTOSCROLL_PRELOAD_MIN_CONCURRENCY = 6;
const PRELOAD_STORAGE_KEY = "reader:preload-window";
const PROGRESS_BAR_KEY = "reader:show-progress-bar";
const DIRECTION_KEY = "reader:default-direction";
const FIT_MODE_KEY = "reader:default-fit-mode";
const AUTOSCROLL_SPEED_KEY = "reader:autoscroll-speed";
const DEFAULT_AUTOSCROLL_SPEED = 70;
const MIN_AUTOSCROLL_SPEED = 20;
const MAX_AUTOSCROLL_SPEED = 500;
const AUTOSCROLL_SPEED_OPTIONS = [30, 50, 70, 90, 120, 160, 220, 300, 400, 500];
// Smart autoscroll. Each page image is sampled in horizontal bands; per-band
// activity (normalized pixel variance) drives the speed. Flat bands — white
// gutters, black fades, solid-color transitions — zip at the max multiplier;
// detail-dense bands ease down to the min. The look-ahead zone weights the
// band the reader is about to enter, with a top-quadrant cutoff so panels
// the reader has already scrolled past stop holding the speed down.
const AUTOSCROLL_SAMPLE_WIDTH = 32;
const AUTOSCROLL_BAND_COUNT = 16;
// 16 rows per band × 16 bands = 256 canvas rows. Large enough that even
// 10000px-tall webtoon strips map ~40 source rows to 1 canvas row with
// smoothing disabled, preserving per-band variance instead of averaging
// the whole page into a mush.
const AUTOSCROLL_BAND_HEIGHT_PX = 16;
// Stddev at which a band is considered maximally "busy". Empirical: flat
// regions sit near 0, packed manga/webtoon detail saturates around 55–65.
const AUTOSCROLL_ACTIVITY_STDDEV_SCALE = 60;
// EMA time-constants (ms) — kept framerate-independent so 60/120/144 Hz
// displays all feel the same. At 60 fps these roughly reproduce the old
// α=0.25 / α=0.08 fixed-frame values (~66ms up, ~200ms down).
const AUTOSCROLL_EMA_TAU_UP_MS = 66;
const AUTOSCROLL_EMA_TAU_DOWN_MS = 200;
const AUTOSCROLL_ZONE_TOP_FRACTION = 0.25;
const AUTOSCROLL_ZONE_FOCUS_FRACTION = 0.6;
const AUTOSCROLL_LOOKAHEAD_MIN_PX = 80;
const AUTOSCROLL_LOOKAHEAD_MAX_VIEWPORTS = 3;
const AUTOSCROLL_MAX_PAGES_SCANNED = 12;
const AUTOSCROLL_SAMPLE_RETRY_DELAYS_MS = [200, 600, 1400];

const SMART_AUTOSCROLL_ENABLED_KEY = "reader:smart-autoscroll-enabled";
const SMART_AUTOSCROLL_MIN_KEY = "reader:smart-autoscroll-min";
const SMART_AUTOSCROLL_MAX_KEY = "reader:smart-autoscroll-max";
const SMART_AUTOSCROLL_SHARP_KEY = "reader:smart-autoscroll-sharp";
const SMART_AUTOSCROLL_LOOK_KEY = "reader:smart-autoscroll-look";

const DEFAULT_SMART_AUTOSCROLL = Object.freeze({
  enabled: true,
  min: 0.25,
  max: 2.5,
  sharp: 1.0,
  look: 0.45,
});
type SmartAutoscrollSettings = {
  enabled: boolean;
  min: number;
  max: number;
  sharp: number;
  look: number;
};

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function getStoredSmartAutoscroll(): SmartAutoscrollSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SMART_AUTOSCROLL };
  try {
    const raw = (key: string) => window.localStorage.getItem(key);
    const enabled = raw(SMART_AUTOSCROLL_ENABLED_KEY);
    const min = Number.parseFloat(raw(SMART_AUTOSCROLL_MIN_KEY) ?? "");
    const max = Number.parseFloat(raw(SMART_AUTOSCROLL_MAX_KEY) ?? "");
    const sharp = Number.parseFloat(raw(SMART_AUTOSCROLL_SHARP_KEY) ?? "");
    const look = Number.parseFloat(raw(SMART_AUTOSCROLL_LOOK_KEY) ?? "");
    return {
      enabled: enabled === null ? DEFAULT_SMART_AUTOSCROLL.enabled : enabled !== "0",
      min: Number.isFinite(min) ? clampNumber(min, 0.1, 1.0) : DEFAULT_SMART_AUTOSCROLL.min,
      max: Number.isFinite(max) ? clampNumber(max, 1.0, 4.0) : DEFAULT_SMART_AUTOSCROLL.max,
      sharp: Number.isFinite(sharp) ? clampNumber(sharp, 0.3, 2.5) : DEFAULT_SMART_AUTOSCROLL.sharp,
      look: Number.isFinite(look) ? clampNumber(look, 0.2, 2.5) : DEFAULT_SMART_AUTOSCROLL.look,
    };
  } catch {
    return { ...DEFAULT_SMART_AUTOSCROLL };
  }
}
// Minimum intra-page ratio delta required to trigger a debounced save while
// the user scrolls within a single tall page. Roughly ~2% of page height —
// tight enough to keep resume accurate, loose enough to avoid hammering the
// server on every RAF tick.
const SCROLL_SAVE_THRESHOLD = 0.02;

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

function getMaxConcurrentPreloads(
  preloadWindow: number,
  options?: { isVertical?: boolean; autoScrollEnabled?: boolean },
) {
  if (options?.isVertical && options.autoScrollEnabled) {
    return Math.max(AUTOSCROLL_PRELOAD_MIN_CONCURRENCY, preloadWindow);
  }
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
  preloadWindow: number,
  autoScrollEnabled = false,
) {
  // Cover the entire preload lookahead with loading="eager" so the <Image>
  // DOM node renders cached bytes the moment it mounts, instead of waiting
  // on the browser's native lazy-load viewport trigger. When autoscroll is
  // running we stretch that window much farther ahead, because the midpoint-
  // based currentPage can advance more slowly than the scroll position and the
  // browser's lazy-load threshold shows up as black pages until the image is
  // already well inside the viewport.
  const baseLookahead = Math.max(
    preloadWindow * PRELOAD_MULTIPLIER,
    VERTICAL_EAGER_PAGE_COUNT - 1,
  );
  const eagerLookahead = autoScrollEnabled
    ? Math.max(baseLookahead * AUTOSCROLL_EAGER_MULTIPLIER, AUTOSCROLL_EAGER_MIN_LOOKAHEAD)
    : baseLookahead;
  return Math.min(
    currentPage + eagerLookahead,
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
  // Last persisted ratio — used by the scroll handler to decide whether the
  // user has moved far enough within a single tall page to be worth saving.
  const lastSavedScrollRatioRef = useRef(0);
  // Always points at the latest `persistProgress` closure so the scroll
  // handler can trigger saves without re-registering the listener.
  const persistProgressRef = useRef<(() => void) | null>(null);
  // Mirrors `currentPage` so the scroll handler can detect page transitions
  // without depending on state (which would rebuild the listener).
  const currentPageRef = useRef(0);
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
  // Accumulator for sub-pixel scroll deltas. Chromium rounds fractional
  // scrollBy to integer pixels, producing a visible 1/2 px stutter pattern
  // at typical autoscroll speeds. Carry the fractional remainder across
  // frames and commit integer deltas only.
  const autoScrollFractionalRef = useRef(0);
  const pageBandActivityRef = useRef<Map<number, Float32Array>>(new Map());
  // Incremented on every chapter load. Captured by in-flight decode+sample
  // callbacks so a late-arriving sample from a previous chapter can't write
  // its band data into the new chapter's index-keyed activity map.
  const activitySampleEpochRef = useRef(0);
  const autoScrollSmoothedMultiplierRef = useRef<number>(1);
  // Survives effect re-runs so a slider-driven autoscroll effect teardown
  // doesn't lose the "I was paused, reset smoothed on resume" signal.
  const autoScrollWasPausedRef = useRef(false);
  // Cached page geometry. Each entry holds doc-coordinate top/height/bottom
  // computed via offsetTop/offsetHeight (layout-cheap) instead of
  // getBoundingClientRect (forces layout when style is dirty). Refreshed
  // on image load, chapter change, and window resize. The autoscroll RAF
  // reads from this map so the hot path does zero forced-layout work.
  const pageMetricsRef = useRef<Array<{ top: number; height: number; bottom: number } | null>>([]);
  // FIFO of pending sample bootstraps. Preload bursts can fire many
  // onLoads in the same frame; we drain one at a time via
  // requestIdleCallback so the 8k-iter pixel loop doesn't steal multiple
  // frames' worth of budget at once.
  const activitySampleRunnersRef = useRef<Array<() => void>>([]);
  const activitySampleDrainPendingRef = useRef(false);
  // Coalesce refreshPageMetrics RAFs during preload bursts. Without this,
  // six concurrent onLoads schedule six RAFs, each doing a full 60-page
  // BCR walk. Flip on schedule, clear on fire.
  const metricsRefreshScheduledRef = useRef(false);
  // Stable per-index ref setters. Without this, every memo recomputation
  // produces fresh inline `(el) => { pageRefs.current[i] = el }` closures
  // and React detaches + reattaches every page ref on each recompute.
  const pageRefSettersRef = useRef<Map<number, (el: HTMLDivElement | null) => void>>(new Map());
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
  const [smartAutoscroll, setSmartAutoscroll] = useState(getStoredSmartAutoscroll);
  const smartAutoscrollRef = useRef(smartAutoscroll);
  useEffect(() => { smartAutoscrollRef.current = smartAutoscroll; }, [smartAutoscroll]);
  const [stateReady, setStateReady] = useState(false);
  const [loadedPageUrls, setLoadedPageUrls] = useState<Record<string, true>>({});
  const [failedPageUrls, setFailedPageUrls] = useState<Record<string, true>>({});
  const [pageRetryVersions, setPageRetryVersions] = useState<Record<string, number>>({});
  const loadedPageUrlsRef = useRef<Record<string, true>>({});
  const failedPageUrlsRef = useRef<Record<string, true>>({});
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
  const verticalEagerPageUpperBound = getVerticalEagerPageUpperBound(
    currentPage,
    pages.length,
    preloadWindow,
    autoScrollEnabled,
  );

  // Recompute cached page metrics. Uses getBoundingClientRect + scrollY
  // so positions are always in document coords regardless of what sits
  // above the reader in the layout tree. BCR is used (not offsetTop) for
  // correctness when the page sits inside a transformed/positioned
  // ancestor; the cost is acceptable because this only runs on discrete
  // events (image load, chapter change, fit-mode change, resize) —
  // NEVER inside the autoscroll RAF, which reads from the cache.
  const refreshPageMetrics = useCallback(() => {
    if (typeof window === "undefined") return;
    const scrollY = window.scrollY;
    pageMetricsRef.current = pageRefs.current.map((el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const top = rect.top + scrollY;
      const height = rect.height;
      return { top, height, bottom: top + height };
    });
  }, []);

  // Single RAF-coalesced wrapper. Multiple onLoads in the same frame
  // produce one refresh, not N.
  const scheduleMetricsRefresh = useCallback(() => {
    if (metricsRefreshScheduledRef.current) return;
    metricsRefreshScheduledRef.current = true;
    window.requestAnimationFrame(() => {
      metricsRefreshScheduledRef.current = false;
      refreshPageMetrics();
    });
  }, [refreshPageMetrics]);

  // Returns the same stable `(el) => { pageRefs.current[index] = el }`
  // function for a given index on every call — avoids ref-callback identity
  // churn inside `verticalPagesNode` on memo recomputes.
  const getPageRefSetter = useCallback((index: number) => {
    let setter = pageRefSettersRef.current.get(index);
    if (!setter) {
      setter = (el: HTMLDivElement | null) => {
        pageRefs.current[index] = el;
      };
      pageRefSettersRef.current.set(index, setter);
    }
    return setter;
  }, []);

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
    // Image swap changes the wrapper's height (placeholder → real aspect),
    // which shifts every subsequent page's top. Coalesced-schedule so a
    // preload burst of N onLoads in the same frame produces exactly one
    // full-page refresh, not N.
    scheduleMetricsRefresh();
  }, [clearPreloadImage, scheduleMetricsRefresh]);

  // Drains one queued sampler per idle tick. Serializing means a preload
  // burst of 6 onLoads produces 6 sequential idle slots of work instead
  // of 6 parallel synchronous sampling passes on the same frame.
  const schedulePumpDrain = useCallback(() => {
    if (activitySampleDrainPendingRef.current) return;
    activitySampleDrainPendingRef.current = true;
    const drain = () => {
      activitySampleDrainPendingRef.current = false;
      const next = activitySampleRunnersRef.current.shift();
      if (!next) return;
      next();
      if (activitySampleRunnersRef.current.length > 0) {
        schedulePumpDrain();
      }
    };
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
    };
    const idleWin = window as IdleWindow;
    if (typeof idleWin.requestIdleCallback === "function") {
      idleWin.requestIdleCallback(drain, { timeout: 1500 });
    } else {
      window.setTimeout(drain, 0);
    }
  }, []);

  // Sample the already-rendered <img> in horizontal bands and compute each
  // band's activity (normalized luma stddev). Same-origin via /api/media/page,
  // so canvas reads don't taint. A single tall image commonly contains
  // gutter → panel → gutter — sampling per band lets autoscroll respond to
  // which vertical slice is currently in view, not an average across the
  // whole strip.
  //
  // Critical details:
  // - `imageSmoothingEnabled = false` — downscaling with smoothing on
  //   averages adjacent pixels and crushes the very variance we're trying
  //   to measure, so flat and busy bands end up looking the same.
  // - `img.decode()` before drawing — iOS Safari occasionally fires `load`
  //   before the raster is drawable, which would give us a transparent
  //   canvas → stddev 0 → "ultra fast" verdict on genuinely dense pages.
  // - On any error or a fully-transparent draw we skip setting the map
  //   entry. `getLookaheadMultiplier` treats missing entries as neutral
  //   (weight 1.0), which is correct regardless of sharpness settings.
  const samplePageActivity = useCallback((index: number) => {
    if (pageBandActivityRef.current.has(index)) return;
    const wrapper = pageRefs.current[index];
    if (!wrapper) return;
    const img = wrapper.querySelector("img") as HTMLImageElement | null;
    if (!img || !img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
      return;
    }

    // Snapshot the chapter generation at sample schedule time. If the user
    // navigates to a new chapter before decode() resolves, this sample is
    // discarded instead of poisoning the new chapter's activity map.
    const epoch = activitySampleEpochRef.current;

    // Returns:
    //   "ok"          — populated the map (or it was already populated)
    //   "undrawable"  — draw produced a transparent/opaque-black canvas;
    //                   caller should retry on a backoff
    //   "stale"       — epoch advanced or DOM identity changed; give up
    //   "error"       — canvas threw; give up
    const runOnce = (): "ok" | "undrawable" | "stale" | "error" => {
      if (activitySampleEpochRef.current !== epoch) return "stale";
      if (pageBandActivityRef.current.has(index)) return "ok";
      // Verify the element / image ref hasn't been recycled by a chapter
      // swap — guards the case where epoch increment and DOM teardown race.
      const wrapperNow = pageRefs.current[index];
      if (!wrapperNow) return "stale";
      const imgNow = wrapperNow.querySelector("img") as HTMLImageElement | null;
      if (!imgNow || imgNow !== img) return "stale";

      try {
        const width = AUTOSCROLL_SAMPLE_WIDTH;
        const height = AUTOSCROLL_BAND_COUNT * AUTOSCROLL_BAND_HEIGHT_PX;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return "error";
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, width, height);
        const { data } = ctx.getImageData(0, 0, width, height);

        // Transparent-canvas bail: iOS Safari can have load/decode resolve
        // before the raster is drawable. Report undrawable so the retry
        // scheduler tries again once the image is actually ready.
        let maxAlpha = 0;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > maxAlpha) maxAlpha = data[i];
          if (maxAlpha >= 128) break;
        }
        if (maxAlpha < 8) return "undrawable";

        const bands = new Float32Array(AUTOSCROLL_BAND_COUNT);
        const pixelsPerBand = width * AUTOSCROLL_BAND_HEIGHT_PX;
        let totalMeanSum = 0;
        let totalActivitySum = 0;
        for (let band = 0; band < AUTOSCROLL_BAND_COUNT; band += 1) {
          const start = band * pixelsPerBand * 4;
          const end = start + pixelsPerBand * 4;
          let sum = 0;
          let sumSq = 0;
          for (let i = start; i < end; i += 4) {
            const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            sum += y;
            sumSq += y * y;
          }
          const mean = sum / pixelsPerBand;
          const variance = Math.max(0, sumSq / pixelsPerBand - mean * mean);
          const stddev = Math.sqrt(variance);
          const activity = clampNumber(stddev / AUTOSCROLL_ACTIVITY_STDDEV_SCALE, 0, 1);
          bands[band] = activity;
          totalMeanSum += mean;
          totalActivitySum += activity;
        }
        // Opaque-black fallback guard (old iOS Safari): if every band is
        // identically "luma 0 with zero variance", the source wasn't really
        // rendered. Real pitch-black panels have compression noise →
        // nonzero stddev. Report undrawable so we retry.
        if (totalMeanSum < 1 && totalActivitySum < 1e-4) return "undrawable";
        // Re-check epoch after the (synchronous) pixel loop — if the user
        // changed chapters while we were crunching, drop the result.
        if (activitySampleEpochRef.current !== epoch) return "stale";
        pageBandActivityRef.current.set(index, bands);
        return "ok";
      } catch {
        return "error";
      }
    };

    const attempt = (attemptsLeft: number) => {
      const status = runOnce();
      if (status !== "undrawable" || attemptsLeft <= 0) return;
      const retryNumber = AUTOSCROLL_SAMPLE_RETRY_DELAYS_MS.length - attemptsLeft;
      const delay =
        AUTOSCROLL_SAMPLE_RETRY_DELAYS_MS[retryNumber] ??
        AUTOSCROLL_SAMPLE_RETRY_DELAYS_MS[AUTOSCROLL_SAMPLE_RETRY_DELAYS_MS.length - 1];
      window.setTimeout(() => {
        if (activitySampleEpochRef.current !== epoch) return;
        attempt(attemptsLeft - 1);
      }, delay);
    };

    const go = () => attempt(AUTOSCROLL_SAMPLE_RETRY_DELAYS_MS.length);

    const enqueue = () => {
      activitySampleRunnersRef.current.push(go);
      schedulePumpDrain();
    };

    if (typeof img.decode === "function") {
      img.decode().then(enqueue, enqueue);
    } else {
      enqueue();
    }
  }, [schedulePumpDrain]);

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

  // Expose the latest persistProgress to refs so scroll-handler saves pick up
  // the current closure (including the up-to-date currentPage) without having
  // to re-attach listeners on every render.
  useEffect(() => {
    persistProgressRef.current = () => persistProgress();
  }, [persistProgress]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    loadedPageUrlsRef.current = loadedPageUrls;
  }, [loadedPageUrls]);

  useEffect(() => {
    failedPageUrlsRef.current = failedPageUrls;
  }, [failedPageUrls]);

  // Weighted average of per-band activity multipliers over the decision
  // zone. Zone = [viewportTop + 25% vh, viewportTop + 60% vh + lookaheadPx].
  // Narrow in-viewport focus band (~35% of vh) sized so manhwa-style
  // half-page gutters can fit inside and register as "pure empty". Above
  // 25% = already read; below zone end = too far.
  //
  // Look-ahead distance intentionally uses the *configured* max cruise
  // speed (`speed * settings.max`) — not the instantaneous smoothed
  // multiplier. Coupling the zone size to the current speed creates a
  // feedback loop around content boundaries (speed up → zone grows →
  // next panel pulled in → speed down → zone shrinks → …) that reads as
  // judder. With the max-based constant, the zone is stable and the EMA
  // alone shapes the ramp.
  //
  // Reads all runtime settings via `smartAutoscrollRef` so slider drags
  // take effect immediately without re-registering the RAF.
  const getLookaheadMultiplier = useCallback((speed: number) => {
    const settings = smartAutoscrollRef.current;
    if (!settings.enabled || pages.length === 0) return 1;
    const { min: multMin, max: multMax, sharp, look } = settings;

    const viewportTop = window.scrollY;
    const vh = window.innerHeight;
    const cruiseSpeed = speed * multMax;
    const lookaheadDistance = Math.min(
      vh * AUTOSCROLL_LOOKAHEAD_MAX_VIEWPORTS,
      Math.max(AUTOSCROLL_LOOKAHEAD_MIN_PX, cruiseSpeed * look),
    );
    const zoneTop = viewportTop + vh * AUTOSCROLL_ZONE_TOP_FRACTION;
    const zoneBottom = viewportTop + vh * AUTOSCROLL_ZONE_FOCUS_FRACTION + lookaheadDistance;

    const currentIndex = clampPage(currentPageRef.current, pages.length);
    const startIndex = Math.max(0, currentIndex - 1);
    const endIndex = Math.min(pages.length - 1, currentIndex + AUTOSCROLL_MAX_PAGES_SCANNED);

    const activityToMultiplier = (activity: number) => {
      const a = clampNumber(activity, 0, 1);
      return multMax - Math.pow(a, sharp) * (multMax - multMin);
    };

    const metrics = pageMetricsRef.current;
    let weightedSum = 0;
    let totalWeight = 0;
    for (let index = startIndex; index <= endIndex; index += 1) {
      const metric = metrics[index];
      // Unseeded metrics (page mounted but first refresh hasn't fired, or
      // detached during chapter transition). Skip and keep scanning —
      // pages further down may still have valid entries.
      if (!metric) continue;
      const pageTop = metric.top;
      const pageBottom = metric.bottom;
      if (pageBottom <= zoneTop) continue;
      if (pageTop >= zoneBottom) break;

      const bands = pageBandActivityRef.current.get(index);
      if (!bands) {
        const overlap = Math.min(pageBottom, zoneBottom) - Math.max(pageTop, zoneTop);
        if (overlap > 0) {
          weightedSum += 1 * overlap;
          totalWeight += overlap;
        }
        continue;
      }

      const pageHeight = metric.height;
      if (pageHeight <= 0) continue;
      const bandHeight = pageHeight / bands.length;
      const firstBand = Math.max(0, Math.floor((zoneTop - pageTop) / bandHeight));
      const lastBand = Math.min(bands.length - 1, Math.ceil((zoneBottom - pageTop) / bandHeight));
      for (let b = firstBand; b <= lastBand; b += 1) {
        const bTop = pageTop + b * bandHeight;
        const bBottom = bTop + bandHeight;
        const overlap = Math.min(bBottom, zoneBottom) - Math.max(bTop, zoneTop);
        if (overlap <= 0) continue;
        weightedSum += activityToMultiplier(bands[b]) * overlap;
        totalWeight += overlap;
      }
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 1;
  }, [pages]);

  const shouldPauseAutoScroll = useCallback(() => {
    if (pages.length === 0) {
      return false;
    }

    const currentIndex = clampPage(currentPageRef.current, pages.length);
    const viewportTop = window.scrollY;
    const lookaheadBottom = viewportTop + window.innerHeight * (1 + AUTOSCROLL_PAUSE_LOOKAHEAD_VIEWPORTS);
    const endIndex = Math.min(currentIndex + 3, pages.length - 1);

    for (let index = currentIndex; index <= endIndex; index += 1) {
      const page = pages[index];
      const metric = pageMetricsRef.current[index];
      if (!page || !metric) {
        continue;
      }

      if (loadedPageUrlsRef.current[page.imageUrl] || failedPageUrlsRef.current[page.imageUrl]) {
        continue;
      }

      if (metric.bottom <= viewportTop) {
        continue;
      }

      if (metric.top <= lookaheadBottom) {
        return true;
      }
    }

    return false;
  }, [pages]);

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
      lastSavedScrollRatioRef.current = 0;
      pageRefs.current = [];
      pageRefSettersRef.current.clear();
      pageBandActivityRef.current.clear();
      pageMetricsRef.current = [];
      activitySampleRunnersRef.current = [];
      activitySampleDrainPendingRef.current = false;
      metricsRefreshScheduledRef.current = false;
      activitySampleEpochRef.current += 1;
      autoScrollSmoothedMultiplierRef.current = 1;
      autoScrollWasPausedRef.current = false;
      autoScrollFractionalRef.current = 0;
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
        lastSavedScrollRatioRef.current = savedRatio;
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

  useEffect(() => {
    try {
      window.localStorage.setItem(SMART_AUTOSCROLL_ENABLED_KEY, smartAutoscroll.enabled ? "1" : "0");
      window.localStorage.setItem(SMART_AUTOSCROLL_MIN_KEY, String(smartAutoscroll.min));
      window.localStorage.setItem(SMART_AUTOSCROLL_MAX_KEY, String(smartAutoscroll.max));
      window.localStorage.setItem(SMART_AUTOSCROLL_SHARP_KEY, String(smartAutoscroll.sharp));
      window.localStorage.setItem(SMART_AUTOSCROLL_LOOK_KEY, String(smartAutoscroll.look));
    } catch {}
  }, [smartAutoscroll]);

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
    // NOTE: don't reset the smoothed multiplier here — this effect re-runs
    // whenever `autoScrollSpeed`, `showInfo`, or other non-chapter deps
    // change, and snapping back to 1 in the middle of a scroll causes a
    // visible hitch. A dedicated effect below resets on enable-toggle, and
    // the chapter-load effect resets on chapter swap. `wasPaused` lives on
    // a ref so it survives effect re-runs too (slider drag, etc.).

    const step = (timestamp: number) => {
      const lastTs = autoScrollLastTsRef.current;
      autoScrollLastTsRef.current = timestamp;

      if (lastTs != null) {
        if (shouldPauseAutoScroll()) {
          autoScrollWasPausedRef.current = true;
          autoScrollRafRef.current = window.requestAnimationFrame(step);
          return;
        }

        // Resuming after a pause: snap back to neutral so we don't keep
        // zooming at the pre-pause multiplier into whatever's now under
        // the viewport (which may be freshly-loaded dense art). Fractional
        // accumulator also clears so the carry doesn't bank up stale pixels
        // during the pause.
        if (autoScrollWasPausedRef.current) {
          autoScrollSmoothedMultiplierRef.current = 1;
          autoScrollFractionalRef.current = 0;
          autoScrollWasPausedRef.current = false;
        }

        // All layout reads happen BEFORE the scrollBy mutation so Chromium
        // doesn't have to re-run layout mid-frame. The exit-condition math
        // projects from the current scrollY using the integer delta we're
        // about to commit, instead of re-reading scrollY after the mutation.
        const scrollY = window.scrollY;
        const viewportHeight = window.innerHeight;
        const scrollHeight = document.documentElement.scrollHeight;
        const maxScrollTop = Math.max(scrollHeight - viewportHeight, 0);

        const deltaSeconds = (timestamp - lastTs) / 1000;
        const prev = autoScrollSmoothedMultiplierRef.current;
        const target = getLookaheadMultiplier(autoScrollSpeed);
        // Asymmetric EMA: ramp up fast when the look-ahead clears (dead
        // space ahead → zip), ease down gently into dense content (so the
        // brake feels natural, not jerky). Time-locked so 120Hz displays
        // don't converge twice as fast as 60Hz — α derived from a target
        // time-constant τ via 1 - exp(-dt / τ).
        const tauMs = target > prev ? AUTOSCROLL_EMA_TAU_UP_MS : AUTOSCROLL_EMA_TAU_DOWN_MS;
        const alpha = 1 - Math.exp(-(deltaSeconds * 1000) / tauMs);
        const smoothed = prev + (target - prev) * alpha;
        autoScrollSmoothedMultiplierRef.current = smoothed;

        autoScrollFractionalRef.current += autoScrollSpeed * deltaSeconds * smoothed;
        const intDelta = Math.trunc(autoScrollFractionalRef.current);

        if (scrollY + intDelta >= maxScrollTop - 1) {
          // Long frame / tab-resume can produce a delta that overshoots
          // the chapter bottom. Land at the exact bottom before stopping
          // so resume-progress captures the true end position.
          const clampedDelta = Math.max(0, maxScrollTop - scrollY);
          if (clampedDelta > 0) {
            window.scrollBy({ top: clampedDelta, behavior: "instant" });
          }
          autoScrollFractionalRef.current = 0;
          setAutoScrollEnabled(false);
          autoScrollRafRef.current = null;
          return;
        }

        if (intDelta !== 0) {
          autoScrollFractionalRef.current -= intDelta;
          window.scrollBy({ top: intDelta, behavior: "instant" });
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
  }, [autoScrollEnabled, autoScrollSpeed, getLookaheadMultiplier, isVertical, pages.length, shouldPauseAutoScroll, showInfo]);

  // Snap smoothed multiplier back to neutral on autoscroll-enable and on
  // smart-autoscroll toggle changes. Without the smart toggle dep, turning
  // smart OFF mid-cruise would leave the RAF easing down from the old
  // multiplier rather than immediately restoring the configured base speed.
  // Intentionally NOT keyed on autoScrollSpeed, showInfo, etc. — those
  // re-run the main RAF effect and resetting there would hitch the scroll.
  useEffect(() => {
    autoScrollSmoothedMultiplierRef.current = 1;
    autoScrollFractionalRef.current = 0;
  }, [autoScrollEnabled, smartAutoscroll.enabled]);

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

  // Seed page metrics when pages first mount, when the fit mode changes
  // (which re-sizes the rendered <Image>), and on window/visualViewport
  // resize. Individual image-load refreshes happen inside markPageLoaded.
  useEffect(() => {
    if (!isVertical || pages.length === 0) return;
    const rafId = window.requestAnimationFrame(() => {
      refreshPageMetrics();
    });
    const onResize = () => refreshPageMetrics();
    window.addEventListener("resize", onResize);
    // Orientation / DPR changes reshape the layout tree in ways resize
    // misses on iOS. Refresh when the viewport unit (dvh/svh) value
    // updates — via the visualViewport API.
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      vv?.removeEventListener("resize", onResize);
    };
  }, [isVertical, pages, preferences.fitMode, refreshPageMetrics]);

  useEffect(() => {
    if (!isVertical || !stateReady || pages.length === 0) return;

    let ticking = false;

    const updateCurrentPage = () => {
      scrollUpdateRafRef.current = null;
      ticking = false;
      const viewportTop = window.scrollY;
      const viewportCenter = viewportTop + window.innerHeight / 2;
      // Preserve current index if nothing matches (e.g. all metrics null
      // during a chapter transition frame) — seeding to 0 would yank the
      // reader back to the top spuriously.
      let closestIndex = currentPageRef.current;
      let closestDistance = Number.POSITIVE_INFINITY;
      let closestMetric: { top: number; height: number; bottom: number } | null = null;

      // Full scan across cached metrics. This was a BCR-per-page walk in
      // the original code, which is where Chromium's cruise jitter came
      // from — every programmatic scrollBy fires a scroll event that
      // re-entered this loop with layout-forcing reads. Now each entry
      // is a cheap object access, so scanning all N pages is O(n) cached
      // reads with no layout impact. Correctness trumps the narrow-scan
      // shortcut the old code attempted.
      const metrics = pageMetricsRef.current;
      for (let index = 0; index < metrics.length; index += 1) {
        const metric = metrics[index];
        if (!metric) continue;
        const midPoint = metric.top + metric.height / 2;
        const distance = Math.abs(midPoint - viewportCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
          closestMetric = metric;
        }
      }

      // Don't touch scrollRatioRef until pending restoration lands, otherwise
      // we'd save "top of page" (ratio 0) over the user's real position.
      if (closestMetric && pendingScrollRatioRef.current == null) {
        const offsetWithinPage = viewportTop - closestMetric.top;
        scrollRatioRef.current = closestMetric.height > 0
          ? clampScrollRatio(offsetWithinPage / closestMetric.height)
          : 0;
      }

      // Only accept a new index when we actually matched a page. Between a
      // chapter-swap clear and the next `[pages]` RAF re-seed, all metrics
      // are null; seeding `setCurrentPage(previousIndex)` would re-enter
      // the old chapter's last-known index into the new chapter.
      const pageChanged = closestMetric != null && closestIndex !== currentPageRef.current;
      if (closestMetric != null) {
        currentPageRef.current = closestIndex;
      }
      if (pageChanged) {
        setCurrentPage(closestIndex);
      } else if (
        closestMetric != null
        && pendingScrollRatioRef.current == null
        && Math.abs(scrollRatioRef.current - lastSavedScrollRatioRef.current) >= SCROLL_SAVE_THRESHOLD
      ) {
        // Tall webtoon pages can occupy thousands of pixels — scrolling
        // within a single page never moves closestIndex, so a page-index
        // save trigger alone would never persist the intra-page offset.
        // Fire a debounced save through the ref so we don't have to
        // re-register the scroll listener just to see the latest closure.
        lastSavedScrollRatioRef.current = scrollRatioRef.current;
        persistProgressRef.current?.();
      }
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
      const maxConcurrentPreloads = getMaxConcurrentPreloads(preloadWindow, {
        isVertical,
        autoScrollEnabled,
      });
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
        // Async decode so concurrent decodes don't block the autoscroll
        // RAF. Safe because nothing depends on the bitmap being ready the
        // instant onload fires — we use img.decode() downstream anyway.
        image.decoding = "async";
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
  }, [autoScrollEnabled, currentPage, isVertical, markPageFailed, markPageLoaded, pages, preloadWindow]);

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
    const maxIndex = isVertical && autoScrollEnabled
      ? verticalEagerPageUpperBound
      : Math.min(currentPage + preloadWindow * PRELOAD_MULTIPLIER, pages.length - 1);
    const firstPreloadIndex = isVertical
      ? (autoScrollEnabled ? currentPage + 1 : verticalEagerPageUpperBound + 1)
      : currentPage + 1;
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
    autoScrollEnabled,
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
    const maxIndex = isVertical && autoScrollEnabled
      ? verticalEagerPageUpperBound
      : Math.min(currentPage + preloadWindow * PRELOAD_MULTIPLIER, pages.length - 1);
    const firstIdx = isVertical
      ? (autoScrollEnabled ? currentPage + 1 : verticalEagerPageUpperBound + 1)
      : currentPage + 1;
    let total = 0;
    let loaded = 0;
    for (let i = firstIdx; i <= maxIndex; i++) {
      const p = pages[i];
      if (!p) continue;
      total++;
      if (loadedPageUrls[p.imageUrl]) loaded++;
    }
    setPreloadProgress({ loaded, total });
  }, [autoScrollEnabled, currentPage, isVertical, loadedPageUrls, pages, preloadWindow, verticalEagerPageUpperBound]);

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

  // Memoize the vertical pages render tree so slider-driven state updates
  // in the settings panel (smartAutoscroll, etc.) don't reconcile every
  // page's subtree on every pointer-move event. The dep list covers every
  // piece of state that actually affects rendered output; stable refs
  // (callbacks, refs) are omitted by convention.
  const verticalPagesNode = useMemo(() => {
    if (!isVertical) return null;
    return pages.map((page) => {
      const pageLoaded = Boolean(loadedPageUrls[page.imageUrl]);
      const pageFailed = Boolean(failedPageUrls[page.imageUrl]);
      return (
        <div
          key={page.index}
          ref={getPageRefSetter(page.index)}
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
            decoding="async"
            onError={() => markPageFailed(page.imageUrl)}
            onLoad={() => {
              markPageLoaded(page.imageUrl);
              samplePageActivity(page.index);
            }}
            priority={
              page.index >= currentPage
              && page.index <= Math.min(verticalEagerPageUpperBound, currentPage + 2)
            }
            unoptimized
          />
        </div>
      );
    });
  }, [
    isVertical,
    pages,
    loadedPageUrls,
    failedPageUrls,
    pageRetryVersions,
    preferences.fitMode,
    currentPage,
    verticalEagerPageUpperBound,
    preloadWindow,
    markPageFailed,
    markPageLoaded,
    retryPageLoad,
    samplePageActivity,
    getPageRefSetter,
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
              <h3 className="font-display text-base leading-none text-text">Reader settings</h3>
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
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">Direction</label>
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
                <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">Fit mode</label>
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
                  <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">Autoscroll</label>
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

              {/* Smart autoscroll */}
              {isVertical && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">Smart autoscroll</label>
                      <span className="text-[10px] text-text-faint">Speeds up through dead space, slows through busy panels.</span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={smartAutoscroll.enabled}
                      onClick={() => setSmartAutoscroll((s) => ({ ...s, enabled: !s.enabled }))}
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-200",
                        smartAutoscroll.enabled ? "bg-accent" : "bg-border",
                      )}
                    >
                      <span
                        className={cn(
                          "h-4 w-4 rounded-full bg-[color:var(--color-text-on-accent)] shadow-sm transition-transform duration-200",
                          smartAutoscroll.enabled ? "translate-x-4" : "translate-x-0",
                        )}
                      />
                    </button>
                  </div>
                  {smartAutoscroll.enabled && (
                    <div className="space-y-2 rounded-sm border border-border-subtle bg-surface-inset/50 px-3 py-2.5">
                      {(
                        [
                          { key: "min" as const, label: "Min ×", step: 0.05, lo: 0.1, hi: 1.0, hint: "speed floor on packed panels" },
                          { key: "max" as const, label: "Max ×", step: 0.1, lo: 1.0, hi: 4.0, hint: "speed ceiling on empty sections" },
                          { key: "sharp" as const, label: "Sharpness γ", step: 0.05, lo: 0.3, hi: 2.5, hint: "curve shape" },
                          { key: "look" as const, label: "Look-ahead (s)", step: 0.05, lo: 0.2, hi: 2.5, hint: "how far to anticipate" },
                        ]
                      ).map(({ key, label, step, lo, hi, hint }) => (
                        <div key={key} className="space-y-0.5">
                          <div className="flex items-baseline justify-between">
                            <span className="text-[11px] text-text-muted">{label}</span>
                            <span className="font-mono text-[11px] tabular-nums text-text">{smartAutoscroll[key].toFixed(2)}</span>
                          </div>
                          <input
                            type="range"
                            min={lo}
                            max={hi}
                            step={step}
                            value={smartAutoscroll[key]}
                            onChange={(e) => {
                              const v = Number.parseFloat(e.target.value);
                              setSmartAutoscroll((s) => ({ ...s, [key]: clampNumber(v, lo, hi) }));
                            }}
                            className="w-full accent-accent"
                          />
                          <p className="text-[10px] text-text-faint">{hint}</p>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setSmartAutoscroll({ ...DEFAULT_SMART_AUTOSCROLL })}
                        className="text-[10px] text-text-faint hover:text-text underline decoration-dotted"
                      >
                        Reset to defaults
                      </button>
                    </div>
                  )}
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
                      "h-4 w-4 rounded-full bg-[color:var(--color-text-on-accent)] shadow-sm transition-transform duration-200",
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
          // Disable browser scroll anchoring only while autoscroll is
          // active. Chromium's anchor-compensation nudges fight our
          // programmatic scrollBy and read as jerk during cruise. With
          // autoscroll off, anchoring is *useful* — it keeps manual scroll
          // position stable when above-viewport placeholders settle into
          // real-aspect heights, so we leave it at its default there.
          style={autoScrollEnabled ? { overflowAnchor: "none" } : undefined}
        >
          {verticalPagesNode}

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
              className="flex items-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-xs font-medium text-[color:var(--color-text-on-accent)] transition-colors hover:bg-accent-muted"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Link
              href={buildSeriesHref(seriesId, seriesSource)}
              className="rounded-sm bg-accent px-3 py-2 text-xs font-medium text-[color:var(--color-text-on-accent)] transition-colors hover:bg-accent-muted"
            >
              Series
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
