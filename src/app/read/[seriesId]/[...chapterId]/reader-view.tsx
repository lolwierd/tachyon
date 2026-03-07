"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Settings2,
  X,
} from "lucide-react";
import { buildReaderHref, buildSeriesHref } from "@/lib/reader/url";
import { cn } from "@/lib/utils";
import { ChapterTransition } from "@/components/chapter-transition";
import type { Chapter, ChapterPage } from "@/lib/sources/types";

type ReadingDirection = "vertical" | "ltr" | "rtl";
type FitMode = "width" | "height" | "original";

interface ReaderStateResponse {
  preferences: {
    readingDirection: ReadingDirection;
    fitMode: FitMode;
  };
  progress: {
    currentPage: number;
    completed: boolean;
    updatedAt: string | null;
  };
}

const DEFAULT_PREFERENCES: ReaderStateResponse["preferences"] = {
  readingDirection: "vertical",
  fitMode: "width",
};

const DEFAULT_PRELOAD_WINDOW = 5;
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

  const savedSpeed = window.localStorage.getItem(AUTOSCROLL_SPEED_KEY);
  const parsedSpeed = savedSpeed ? Number.parseFloat(savedSpeed) : Number.NaN;
  return Number.isFinite(parsedSpeed)
    ? normalizeAutoscrollSpeed(parsedSpeed)
    : DEFAULT_AUTOSCROLL_SPEED;
}

function getLocalStorageDefaults(): typeof DEFAULT_PREFERENCES {
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
}

function clampPage(page: number, pageCount: number) {
  return Math.min(Math.max(page, 0), Math.max(pageCount - 1, 0));
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
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const restoreDoneRef = useRef(false);
  const preferencesLoadedRef = useRef(false);
  const saveAbortRef = useRef<AbortController | null>(null);
  const preloadedUrlsRef = useRef<Set<string>>(new Set());
  const preloadImageRefs = useRef<Map<string, HTMLImageElement>>(new Map());
  const preloadQueueRef = useRef<string[]>([]);
  const preloadActiveRef = useRef(false);
  const processPreloadQueueRef = useRef<() => void>(() => { });
  const autoScrollRafRef = useRef<number | null>(null);
  const autoScrollLastTsRef = useRef<number | null>(null);
  const lastTapTimeRef = useRef(0);
  const singleTapTimerRef = useRef<number | null>(null);
  const settingsOpenedAtRef = useRef(0);

  const [pages, setPages] = useState<ChapterPage[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
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

  const currentIdx = chapters.findIndex((item) => item.sourceChapterId === chapterId);
  const currentChapter = currentIdx >= 0 ? chapters[currentIdx] : null;
  const prevChapter = currentIdx > 0 ? chapters[currentIdx - 1] : null;
  const nextChapter =
    currentIdx >= 0 && currentIdx < chapters.length - 1 ? chapters[currentIdx + 1] : null;
  const isVertical = preferences.readingDirection === "vertical";
  const progressPercent =
    pages.length > 0 ? ((currentPage + 1) / pages.length) * 100 : 0;
  const currentPageUrl = pages[currentPage]?.imageUrl ?? null;
  const currentPageLoaded = currentPageUrl ? Boolean(loadedPageUrls[currentPageUrl]) : false;
  const currentPageFailed = currentPageUrl ? Boolean(failedPageUrls[currentPageUrl]) : false;

  const clearPreloadImage = useCallback((url: string) => {
    const image = preloadImageRefs.current.get(url);
    if (!image) {
      return;
    }

    image.onload = null;
    image.onerror = null;
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

  const markPageFailed = useCallback((url: string) => {
    clearPreloadImage(url);
    setFailedPageUrls((previous) => (
      previous[url]
        ? previous
        : { ...previous, [url]: true }
    ));
  }, [clearPreloadImage]);

  const stopAutoScroll = useCallback(() => {
    setAutoScrollEnabled(false);
  }, []);

  const toggleInfo = useCallback(() => {
    setShowInfo((v) => !v);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setLoading(true);
      setStateReady(false);
      restoreDoneRef.current = false;
      pageRefs.current = [];
      preloadedUrlsRef.current.clear();
      preloadImageRefs.current.forEach((image) => {
        image.onload = null;
        image.onerror = null;
      });
      preloadImageRefs.current.clear();
      preloadQueueRef.current = [];
      preloadActiveRef.current = false;
      setLoadedPageUrls({});
      setFailedPageUrls({});

      try {
        const chapterPageParams = new URLSearchParams({
          seriesId,
        });
        if (seriesSource) {
          chapterPageParams.set("source", seriesSource);
        }

        const [pagesRes, chaptersRes, stateRes] = await Promise.all([
          fetch(`/api/chapters/${encodeURIComponent(chapterId)}/pages?${chapterPageParams.toString()}`),
          fetch(`/api/series/${encodeURIComponent(seriesId)}/chapters${seriesSource ? `?source=${encodeURIComponent(seriesSource)}` : ""}`),
          fetch(`/api/reader/state?seriesId=${encodeURIComponent(seriesId)}&chapterId=${encodeURIComponent(chapterId)}`),
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

        setPages(nextPages);
        setChapters(nextChapters);
        setPreferences(nextState.preferences);
        setCurrentPage(clampPage(nextState.progress.currentPage, nextPages.length || 1));
        setAutoScrollEnabled(false);
        setStateReady(true);
      } catch {
        if (!isCancelled) {
          setPages([]);
          setChapters([]);
          setPreferences(getLocalStorageDefaults());
          setCurrentPage(0);
          setAutoScrollEnabled(false);
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
        readingDirection: preferences.readingDirection,
        fitMode: preferences.fitMode,
      }),
      signal: controller.signal,
    }).catch(() => { });

    return () => controller.abort();
  }, [preferences, seriesId, stateReady]);

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
      } else {
        window.scrollTo({ top: 0 });
      }
      return;
    }

    if (!isVertical) window.scrollTo({ top: 0 });
  }, [currentPage, isVertical, pages.length, stateReady]);

  useEffect(() => {
    if (!isVertical || !stateReady || pages.length === 0) return;

    let ticking = false;

    const updateCurrentPage = () => {
      ticking = false;
      const viewportCenter = window.innerHeight / 2;
      let closestIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;

      pageRefs.current.forEach((element, index) => {
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const midPoint = rect.top + rect.height / 2;
        const distance = Math.abs(midPoint - viewportCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });

      setCurrentPage((prev) => (prev === closestIndex ? prev : closestIndex));
    };

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateCurrentPage);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, [isVertical, pages.length, stateReady]);

  useEffect(() => {
    if (!stateReady || pages.length === 0 || !currentChapter) return;

    saveAbortRef.current?.abort();
    const controller = new AbortController();
    saveAbortRef.current = controller;

    const timeoutId = window.setTimeout(() => {
      void fetch("/api/reader/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seriesId,
          chapterId,
          chapterTitle: currentChapter.title,
          chapterNo: currentChapter.chapterNo,
          pageCount: pages.length,
          currentPage,
          completed: currentPage >= pages.length - 1,
        }),
        signal: controller.signal,
      }).catch(() => { });
    }, 800);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [chapterId, currentChapter, currentPage, pages.length, seriesId, stateReady]);

  // Keep processPreloadQueueRef current so the recursive callback always uses latest marks
  useEffect(() => {
    processPreloadQueueRef.current = () => {
      if (preloadActiveRef.current || preloadQueueRef.current.length === 0) return;
      const url = preloadQueueRef.current.shift()!;
      preloadActiveRef.current = true;
      const image = new window.Image();
      image.onload = () => {
        markPageLoaded(url);
        preloadActiveRef.current = false;
        processPreloadQueueRef.current();
      };
      image.onerror = () => {
        markPageFailed(url);
        preloadActiveRef.current = false;
        processPreloadQueueRef.current();
      };
      image.src = url;
      preloadImageRefs.current.set(url, image);
    };
  }, [markPageFailed, markPageLoaded]);

  // Sequential preload: one image at a time, closest page first
  useEffect(() => {
    if (pages.length === 0 || preloadWindow <= 0) return;
    const maxIndex = Math.min(currentPage + preloadWindow, pages.length - 1);
    let addedAny = false;
    for (let index = currentPage + 1; index <= maxIndex; index += 1) {
      const page = pages[index];
      if (!page || preloadedUrlsRef.current.has(page.imageUrl)) continue;
      preloadedUrlsRef.current.add(page.imageUrl);
      preloadQueueRef.current.push(page.imageUrl);
      addedAny = true;
    }
    if (addedAny) processPreloadQueueRef.current();
  }, [currentPage, pages, preloadWindow]);

  const goToPreviousPage = useCallback(() => {
    if (currentPage > 0) {
      setCurrentPage((v) => v - 1);
      return;
    }
    if (prevChapter) router.push(buildReaderHref(seriesId, prevChapter.sourceChapterId, seriesSource));
  }, [currentPage, prevChapter, router, seriesId, seriesSource]);

  const goToNextPage = useCallback(() => {
    if (currentPage < pages.length - 1) {
      setCurrentPage((v) => v + 1);
      return;
    }
    if (nextChapter) router.push(buildReaderHref(seriesId, nextChapter.sourceChapterId, seriesSource));
  }, [currentPage, nextChapter, pages.length, router, seriesId, seriesSource]);

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

      if (event.key === "[") {
        event.preventDefault();
        if (prevChapter) router.push(buildReaderHref(seriesId, prevChapter.sourceChapterId, seriesSource));
        return;
      }

      if (event.key === "]") {
        event.preventDefault();
        if (nextChapter) router.push(buildReaderHref(seriesId, nextChapter.sourceChapterId, seriesSource));
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
          router.push(buildReaderHref(seriesId, prevChapter.sourceChapterId, seriesSource));
        }
        if (event.key === "ArrowRight" && nextChapter) {
          event.preventDefault();
          router.push(buildReaderHref(seriesId, nextChapter.sourceChapterId, seriesSource));
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
    nextChapter,
    pages.length,
    preferences.readingDirection,
    prevChapter,
    router,
    seriesId,
    seriesSource,
    stopAutoScroll,
  ]);

  function handleChapterTransition() {
    if (nextChapter) {
      router.push(buildReaderHref(seriesId, nextChapter.sourceChapterId, seriesSource));
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
      <div className="flex min-h-dvh items-center justify-center bg-void">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
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
              onClick={() => router.push(buildReaderHref(seriesId, prevChapter.sourceChapterId, seriesSource))}
              className="flex items-center gap-1.5 p-1.5 text-sm text-text-muted transition-colors hover:text-text"
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </button>
          ) : (
            <div className="w-16" />
          )}
          <p className="font-mono text-sm text-text-muted">
            {Math.min(currentPage + 1, Math.max(pages.length, 1))} / {pages.length || 1}
          </p>
          <div className="flex items-center gap-1">
            {nextChapter ? (
              <button
                onClick={() => router.push(buildReaderHref(seriesId, nextChapter.sourceChapterId, seriesSource))}
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
              router.push(buildReaderHref(seriesId, e.target.value, seriesSource));
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
            </div>

            {/* Keyboard shortcuts hint */}
            <div className="border-t border-border-subtle px-4 py-2.5">
              <p className="text-center font-mono text-[10px] text-text-faint">
                M direction · F fit · A / Space autoscroll · −/+ speed
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
                  <div className="absolute inset-0 flex min-h-[40dvh] items-center justify-center bg-void">
                    <Loader2 className="h-5 w-5 animate-spin text-accent" />
                  </div>
                )}
                {pageFailed && (
                  <div className="absolute inset-0 flex min-h-[40dvh] items-center justify-center bg-void px-4">
                    <p className="text-center text-sm text-text-muted">Page failed to load. Scroll away and back or reopen the chapter.</p>
                  </div>
                )}
                <Image
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
                  loading={page.index <= currentPage + preloadWindow ? "eager" : "lazy"}
                  onError={() => markPageFailed(page.imageUrl)}
                  onLoad={() => markPageLoaded(page.imageUrl)}
                  priority={page.index < 3}
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

          <div className="flex min-h-[85dvh] items-center justify-center px-4">
            {!currentPageLoaded && !currentPageFailed && (
              <div className="absolute inset-0 flex items-center justify-center bg-void">
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
              </div>
            )}
            {currentPageFailed && (
              <div className="absolute inset-0 flex items-center justify-center bg-void px-4">
                <p className="text-center text-sm text-text-muted">Page failed to load. Move to another page and back after the source warms up.</p>
              </div>
            )}
            <Image
              key={pages[currentPage]?.imageUrl ?? currentPage}
              src={pages[currentPage]?.imageUrl ?? ""}
              alt={`Page ${currentPage + 1}`}
              width={1400}
              height={2000}
              className={cn(pagedImageClassName, !currentPageLoaded && "opacity-0")}
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
              onClick={() => router.push(buildReaderHref(seriesId, prevChapter.sourceChapterId, seriesSource))}
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
              onClick={() => router.push(buildReaderHref(seriesId, nextChapter.sourceChapterId, seriesSource))}
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
