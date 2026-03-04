"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Home,
  Loader2,
  Maximize,
  Minimize,
  MoreHorizontal,
  MonitorUp,
  ScrollText,
  X,
} from "lucide-react";
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

const FIT_MODE_LABELS: Record<FitMode, string> = {
  width: "Width",
  height: "Height",
  original: "Original",
};

const MODE_LABELS: Record<ReadingDirection, string> = {
  vertical: "Scroll",
  ltr: "LTR",
  rtl: "RTL",
};

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
  chapterId,
}: {
  seriesId: string;
  chapterId: string;
}) {
  const router = useRouter();
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const restoreDoneRef = useRef(false);
  const preferencesLoadedRef = useRef(false);
  const saveAbortRef = useRef<AbortController | null>(null);

  const [pages, setPages] = useState<ChapterPage[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUI, setShowUI] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [stateReady, setStateReady] = useState(false);

  const currentIdx = chapters.findIndex((item) => item.sourceChapterId === chapterId);
  const currentChapter = currentIdx >= 0 ? chapters[currentIdx] : null;
  const prevChapter = currentIdx > 0 ? chapters[currentIdx - 1] : null;
  const nextChapter =
    currentIdx >= 0 && currentIdx < chapters.length - 1 ? chapters[currentIdx + 1] : null;
  const isVertical = preferences.readingDirection === "vertical";
  const progressPercent =
    pages.length > 0 ? ((currentPage + 1) / pages.length) * 100 : 0;

  /* ── Data loading ── */

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      setLoading(true);
      setStateReady(false);
      restoreDoneRef.current = false;
      pageRefs.current = [];

      try {
        const [pagesRes, chaptersRes, stateRes] = await Promise.all([
          fetch(`/api/chapters/${chapterId}/pages`),
          fetch(`/api/series/${seriesId}/chapters`),
          fetch(`/api/reader/state?seriesId=${seriesId}&chapterId=${chapterId}`),
        ]);

        if (isCancelled) return;

        const nextPages = pagesRes.ok ? ((await pagesRes.json()) as ChapterPage[]) : [];
        const nextChapters = chaptersRes.ok ? ((await chaptersRes.json()) as Chapter[]) : [];
        const nextState = stateRes.ok
          ? ((await stateRes.json()) as ReaderStateResponse)
          : {
            preferences: DEFAULT_PREFERENCES,
            progress: { currentPage: 0, completed: false, updatedAt: null },
          };

        setPages(nextPages);
        setChapters(nextChapters);
        setPreferences(nextState.preferences);
        setCurrentPage(clampPage(nextState.progress.currentPage, nextPages.length || 1));
        setStateReady(true);
      } catch {
        if (!isCancelled) {
          setPages([]);
          setChapters([]);
          setPreferences(DEFAULT_PREFERENCES);
          setCurrentPage(0);
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
  }, [chapterId, seriesId]);

  /* ── Preference persistence ── */

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

  /* ── Scroll position restore / page change ── */

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

  /* ── Vertical scroll tracking ── */

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

  /* ── Progress persistence (debounced) ── */

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

  /* ── Paged navigation helpers ── */

  const goToPreviousPage = useCallback(() => {
    if (currentPage > 0) {
      setCurrentPage((v) => v - 1);
      return;
    }
    if (prevChapter) router.push(`/read/${seriesId}/${prevChapter.sourceChapterId}`);
  }, [currentPage, prevChapter, router, seriesId]);

  const goToNextPage = useCallback(() => {
    if (currentPage < pages.length - 1) {
      setCurrentPage((v) => v + 1);
      return;
    }
    if (nextChapter) router.push(`/read/${seriesId}/${nextChapter.sourceChapterId}`);
  }, [currentPage, nextChapter, pages.length, router, seriesId]);

  /* ── Keyboard navigation ── */

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

      if (event.key === "Escape" || event.key.toLowerCase() === "u") {
        event.preventDefault();
        setShowUI((v) => !v);
        return;
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

      if (event.key === "h" || event.key === "H") {
        event.preventDefault();
        router.push("/");
        return;
      }

      if (event.key === "[") {
        event.preventDefault();
        if (prevChapter) router.push(`/read/${seriesId}/${prevChapter.sourceChapterId}`);
        return;
      }

      if (event.key === "]") {
        event.preventDefault();
        if (nextChapter) router.push(`/read/${seriesId}/${nextChapter.sourceChapterId}`);
        return;
      }

      if (pages.length === 0) return;

      if (isVertical) {
        if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
          event.preventDefault();
          window.scrollBy({ top: window.innerHeight * 0.85, behavior: "smooth" });
        }
        if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
          event.preventDefault();
          window.scrollBy({ top: -window.innerHeight * 0.85, behavior: "smooth" });
        }
        if (event.key === "ArrowLeft" && prevChapter) {
          event.preventDefault();
          router.push(`/read/${seriesId}/${prevChapter.sourceChapterId}`);
        }
        if (event.key === "ArrowRight" && nextChapter) {
          event.preventDefault();
          router.push(`/read/${seriesId}/${nextChapter.sourceChapterId}`);
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
    goToNextPage,
    goToPreviousPage,
    isVertical,
    nextChapter,
    pages.length,
    preferences.readingDirection,
    prevChapter,
    router,
    seriesId,
  ]);

  /* ── Chapter transition handler ── */

  function handleChapterTransition() {
    if (nextChapter) {
      router.push(`/read/${seriesId}/${nextChapter.sourceChapterId}`);
    }
  }

  /* ── Loading state ── */

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
      {/* ── Progress line ── */}
      <div className="fixed inset-x-0 top-0 z-[70] h-0.5 bg-border-subtle">
        <div
          className="h-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* ── Overlay UI ── */}
      <div
        className={cn(
          "fixed inset-x-0 top-0.5 z-50 bg-void/70 backdrop-blur-md transition-all duration-200",
          showUI ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none",
        )}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          {/* Left: Home + Back */}
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="rounded-sm p-1.5 text-text-muted transition-colors hover:text-accent"
              aria-label="Home"
            >
              <Home className="h-4 w-4" />
            </Link>
            <Link
              href={`/series/${seriesId}`}
              className="text-xs text-text-faint transition-colors hover:text-text-muted"
            >
              Series
            </Link>
          </div>

          {/* Center: Title + page */}
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-sm text-text">
              {currentChapter?.title ?? "Reader"}
            </p>
            <p className="font-mono text-[11px] text-text-faint">
              {Math.min(currentPage + 1, Math.max(pages.length, 1))}/{pages.length || 1}
            </p>
          </div>

          {/* Right: Mode controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={() =>
                setPreferences((v) => ({
                  ...v,
                  readingDirection: nextReadingDirection(v.readingDirection),
                }))
              }
              className="flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-[11px] text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
              title={`Mode: ${MODE_LABELS[preferences.readingDirection]}`}
            >
              {preferences.readingDirection === "vertical" ? (
                <ScrollText className="h-3.5 w-3.5" />
              ) : (
                <Columns2 className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {MODE_LABELS[preferences.readingDirection]}
              </span>
            </button>

            <button
              onClick={() =>
                setPreferences((v) => ({ ...v, fitMode: nextFitMode(v.fitMode) }))
              }
              className="flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-[11px] text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
              title={`Fit: ${FIT_MODE_LABELS[preferences.fitMode]}`}
            >
              {preferences.fitMode === "width" && <MonitorUp className="h-3.5 w-3.5" />}
              {preferences.fitMode === "height" && <Maximize className="h-3.5 w-3.5" />}
              {preferences.fitMode === "original" && <Minimize className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">
                {FIT_MODE_LABELS[preferences.fitMode]}
              </span>
            </button>

            <button
              onClick={() => setShowUI(false)}
              className="rounded-sm p-1.5 text-text-faint transition-colors hover:text-text-muted"
              aria-label="Close overlay"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Toggle button (always visible) ── */}
      <button
        onClick={() => setShowUI((v) => !v)}
        className={cn(
          "fixed right-3 top-2 z-[60] rounded-sm p-1.5 transition-all duration-200",
          showUI
            ? "opacity-0 pointer-events-none"
            : "bg-void/50 text-text-faint backdrop-blur-sm hover:bg-surface-raised hover:text-text-muted",
        )}
        aria-label="Toggle reader controls"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {/* ── Vertical mode ── */}
      {isVertical ? (
        <div className="mx-auto max-w-5xl">
          {pages.map((page) => (
            <div
              key={page.index}
              ref={(el) => {
                pageRefs.current[page.index] = el;
              }}
              className="relative w-full"
            >
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
                )}
                priority={page.index < 3}
                unoptimized
              />
            </div>
          ))}

          {/* Chapter transition zone (auto-advance) */}
          {nextChapter && pages.length > 0 && (
            <ChapterTransition
              completedTitle={currentChapter?.title ?? "Chapter"}
              nextTitle={nextChapter.title}
              onAdvance={handleChapterTransition}
            />
          )}

          {/* End of series */}
          {!nextChapter && pages.length > 0 && (
            <div className="flex flex-col items-center gap-3 py-16">
              <p className="font-display text-lg italic text-text-muted">
                You&rsquo;ve reached the latest chapter
              </p>
              <Link
                href={`/series/${seriesId}`}
                className="text-xs text-accent transition-colors hover:text-accent-muted"
              >
                Back to series
              </Link>
            </div>
          )}
        </div>
      ) : pages.length > 0 ? (
        /* ── Paged mode ── */
        <div className="relative flex min-h-dvh items-center justify-center">
          {/* Invisible tap zones */}
          <button
            onClick={preferences.readingDirection === "rtl" ? goToNextPage : goToPreviousPage}
            className="absolute inset-y-0 left-0 z-10 w-1/3 cursor-w-resize focus:outline-none"
            aria-label="Previous page"
          />
          <button
            onClick={() => setShowUI((v) => !v)}
            className="absolute inset-y-0 left-1/3 z-10 w-1/3 cursor-pointer focus:outline-none"
            aria-label="Toggle UI"
          />
          <button
            onClick={preferences.readingDirection === "rtl" ? goToPreviousPage : goToNextPage}
            className="absolute inset-y-0 right-0 z-10 w-1/3 cursor-e-resize focus:outline-none"
            aria-label="Next page"
          />

          <div className="flex min-h-[85dvh] items-center justify-center px-4">
            <img
              key={pages[currentPage]?.imageUrl ?? currentPage}
              src={pages[currentPage]?.imageUrl ?? ""}
              alt={`Page ${currentPage + 1}`}
              className={pagedImageClassName}
            />
          </div>

          {/* Subtle page arrows (desktop only, edges) */}
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

      {/* ── Bottom chapter nav (paged mode only) ── */}
      {!isVertical && pages.length > 0 && (
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 text-sm">
          {prevChapter ? (
            <button
              onClick={() => router.push(`/read/${seriesId}/${prevChapter.sourceChapterId}`)}
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
              onClick={() => router.push(`/read/${seriesId}/${nextChapter.sourceChapterId}`)}
              className="flex items-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-xs font-medium text-void transition-colors hover:bg-accent-muted"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Link
              href={`/series/${seriesId}`}
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
