"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Loader2,
  Maximize,
  Menu,
  Minimize,
  MonitorUp,
  ScrollText,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  width: "Fit width",
  height: "Fit height",
  original: "Original size",
};

const READING_MODE_LABELS: Record<ReadingDirection, string> = {
  vertical: "Vertical",
  ltr: "Paged LTR",
  rtl: "Paged RTL",
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
  const nextChapter = currentIdx >= 0 && currentIdx < chapters.length - 1 ? chapters[currentIdx + 1] : null;
  const isVertical = preferences.readingDirection === "vertical";

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

        if (isCancelled) {
          return;
        }

        const nextPages = pagesRes.ok ? ((await pagesRes.json()) as ChapterPage[]) : [];
        const nextChapters = chaptersRes.ok ? ((await chaptersRes.json()) as Chapter[]) : [];
        const nextState = stateRes.ok
          ? ((await stateRes.json()) as ReaderStateResponse)
          : {
              preferences: DEFAULT_PREFERENCES,
              progress: {
                currentPage: 0,
                completed: false,
                updatedAt: null,
              },
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
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      isCancelled = true;
    };
  }, [chapterId, seriesId]);

  useEffect(() => {
    if (!stateReady) {
      return;
    }

    if (!preferencesLoadedRef.current) {
      preferencesLoadedRef.current = true;
      return;
    }

    const controller = new AbortController();
    void fetch("/api/reader/state", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        seriesId,
        readingDirection: preferences.readingDirection,
        fitMode: preferences.fitMode,
      }),
      signal: controller.signal,
    }).catch(() => {
      // Intentionally quiet; preferences can retry on the next change.
    });

    return () => {
      controller.abort();
    };
  }, [preferences, seriesId, stateReady]);

  useEffect(() => {
    if (!stateReady || pages.length === 0) {
      return;
    }

    const clampedPage = clampPage(currentPage, pages.length);
    if (clampedPage !== currentPage) {
      setCurrentPage(clampedPage);
      return;
    }

    if (!restoreDoneRef.current) {
      restoreDoneRef.current = true;
      if (isVertical) {
        const target = pageRefs.current[clampedPage];
        if (target) {
          target.scrollIntoView({ block: "start" });
        } else {
          window.scrollTo({ top: 0 });
        }
      } else {
        window.scrollTo({ top: 0 });
      }
      return;
    }

    if (!isVertical) {
      window.scrollTo({ top: 0 });
    }
  }, [currentPage, isVertical, pages.length, stateReady]);

  useEffect(() => {
    if (!isVertical || !stateReady || pages.length === 0) {
      return;
    }

    let ticking = false;

    const updateCurrentPage = () => {
      ticking = false;
      const viewportCenter = window.innerHeight / 2;
      let closestIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;

      pageRefs.current.forEach((element, index) => {
        if (!element) {
          return;
        }
        const rect = element.getBoundingClientRect();
        const midPoint = rect.top + rect.height / 2;
        const distance = Math.abs(midPoint - viewportCenter);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });

      setCurrentPage((previous) => (previous === closestIndex ? previous : closestIndex));
    };

    const handleScroll = () => {
      if (ticking) {
        return;
      }
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
    if (!stateReady || pages.length === 0 || !currentChapter) {
      return;
    }

    saveAbortRef.current?.abort();
    const controller = new AbortController();
    saveAbortRef.current = controller;
    const timeoutId = window.setTimeout(() => {
      void fetch("/api/reader/state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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
      }).catch(() => {
        // Quiet failure; reading should stay uninterrupted.
      });
    }, 800);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [chapterId, currentChapter, currentPage, pages.length, seriesId, stateReady]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "Escape" || event.key.toLowerCase() === "u") {
        event.preventDefault();
        setShowUI((value) => !value);
        return;
      }

      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        setPreferences((value) => ({
          ...value,
          readingDirection: nextReadingDirection(value.readingDirection),
        }));
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setPreferences((value) => ({
          ...value,
          fitMode: nextFitMode(value.fitMode),
        }));
        return;
      }

      if (event.key === "[") {
        event.preventDefault();
        if (prevChapter) {
          router.push(`/read/${seriesId}/${prevChapter.sourceChapterId}`);
        }
        return;
      }

      if (event.key === "]") {
        event.preventDefault();
        if (nextChapter) {
          router.push(`/read/${seriesId}/${nextChapter.sourceChapterId}`);
        }
        return;
      }

      if (pages.length === 0) {
        return;
      }

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

      const goToPreviousPage = () => {
        if (currentPage > 0) {
          setCurrentPage((value) => value - 1);
          return;
        }
        if (prevChapter) {
          router.push(`/read/${seriesId}/${prevChapter.sourceChapterId}`);
        }
      };

      const goToNextPage = () => {
        if (currentPage < pages.length - 1) {
          setCurrentPage((value) => value + 1);
          return;
        }
        if (nextChapter) {
          router.push(`/read/${seriesId}/${nextChapter.sourceChapterId}`);
        }
      };

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
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentPage, isVertical, nextChapter, pages.length, preferences.readingDirection, prevChapter, router, seriesId]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-void">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  const pagedImageClassName = cn(
    "mx-auto object-contain",
    preferences.fitMode === "width" && "h-auto w-full",
    preferences.fitMode === "height" && "h-[calc(100dvh-9rem)] w-auto max-w-full",
    preferences.fitMode === "original" && "h-auto w-auto max-w-full",
  );

  const goToPreviousPage = () => {
    if (currentPage > 0) {
      setCurrentPage((value) => value - 1);
      return;
    }
    if (prevChapter) {
      router.push(`/read/${seriesId}/${prevChapter.sourceChapterId}`);
    }
  };

  const goToNextPage = () => {
    if (currentPage < pages.length - 1) {
      setCurrentPage((value) => value + 1);
      return;
    }
    if (nextChapter) {
      router.push(`/read/${seriesId}/${nextChapter.sourceChapterId}`);
    }
  };

  return (
    <div className="relative min-h-dvh bg-void text-text">
      <div
        className={cn(
          "fixed inset-x-0 top-0 z-50 border-b border-border/40 bg-void/90 backdrop-blur-xl transition-all duration-300",
          showUI ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0",
        )}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link
            href={`/series/${seriesId}`}
            className="flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-text"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back to series</span>
          </Link>

          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-sm font-medium text-text">
              {currentChapter?.title ?? "Reader"}
            </p>
            <p className="text-xs text-text-faint">
              Page {Math.min(currentPage + 1, Math.max(pages.length, 1))} / {pages.length || 1}
            </p>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <button
              onClick={() =>
                setPreferences((value) => ({
                  ...value,
                  readingDirection: nextReadingDirection(value.readingDirection),
                }))
              }
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent-muted hover:text-text"
            >
              {preferences.readingDirection === "vertical" ? (
                <ScrollText className="h-4 w-4" />
              ) : (
                <Columns2 className="h-4 w-4" />
              )}
              {READING_MODE_LABELS[preferences.readingDirection]}
            </button>

            <button
              onClick={() =>
                setPreferences((value) => ({
                  ...value,
                  fitMode: nextFitMode(value.fitMode),
                }))
              }
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent-muted hover:text-text"
            >
              {preferences.fitMode === "width" && <MonitorUp className="h-4 w-4" />}
              {preferences.fitMode === "height" && <Maximize className="h-4 w-4" />}
              {preferences.fitMode === "original" && <Minimize className="h-4 w-4" />}
              {FIT_MODE_LABELS[preferences.fitMode]}
            </button>
          </div>
        </div>
      </div>

      <button
        onClick={() => setShowUI((value) => !value)}
        className="fixed right-4 top-4 z-[60] rounded-full border border-border/50 bg-surface/85 p-2 text-text-muted backdrop-blur-sm transition-colors hover:bg-surface-raised hover:text-text"
        aria-label="Toggle reader interface"
      >
        {showUI ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {isVertical ? (
        <div className="mx-auto max-w-5xl pt-0">
          {pages.map((page) => (
            <div
              key={page.index}
              ref={(element) => {
                pageRefs.current[page.index] = element;
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
                  "mx-auto h-auto",
                  preferences.fitMode === "width" && "w-full",
                  preferences.fitMode === "height" && "max-h-dvh w-auto",
                  preferences.fitMode === "original" && "w-auto max-w-full",
                )}
                priority={page.index < 3}
                unoptimized
              />
            </div>
          ))}
        </div>
      ) : pages.length > 0 ? (
        <div className="mx-auto flex min-h-dvh max-w-7xl items-center justify-center px-4 py-20">
          <div className="relative w-full">
            <div className="absolute inset-y-0 left-0 flex w-20 items-center justify-start">
              <button
                onClick={preferences.readingDirection === "rtl" ? goToNextPage : goToPreviousPage}
                className="rounded-full border border-border/50 bg-surface/80 p-3 text-text-muted backdrop-blur-sm transition-colors hover:bg-surface-raised hover:text-text"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            </div>

            <div className="flex min-h-[70dvh] items-center justify-center">
              <img
                key={pages[currentPage]?.imageUrl ?? currentPage}
                src={pages[currentPage]?.imageUrl ?? ""}
                alt={`Page ${currentPage + 1}`}
                className={pagedImageClassName}
              />
            </div>

            <div className="absolute inset-y-0 right-0 flex w-20 items-center justify-end">
              <button
                onClick={preferences.readingDirection === "rtl" ? goToPreviousPage : goToNextPage}
                className="rounded-full border border-border/50 bg-surface/80 p-3 text-text-muted backdrop-blur-sm transition-colors hover:bg-surface-raised hover:text-text"
                aria-label="Next page"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-dvh items-center justify-center text-sm text-text-muted">
          No pages available for this chapter.
        </div>
      )}

      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 border-t border-border/30 px-4 py-6 text-sm">
        {prevChapter ? (
          <button
            onClick={() => router.push(`/read/${seriesId}/${prevChapter.sourceChapterId}`)}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-text transition-colors hover:border-accent-muted hover:text-accent"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{prevChapter.title}</span>
            <span className="sm:hidden">Prev</span>
          </button>
        ) : (
          <div />
        )}

        <div className="hidden text-center text-xs text-text-faint md:block">
          <p>`[` / `]` chapter</p>
          <p>`M` mode, `F` fit, `U` UI</p>
        </div>

        {nextChapter ? (
          <button
            onClick={() => router.push(`/read/${seriesId}/${nextChapter.sourceChapterId}`)}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 font-medium text-void transition-colors hover:bg-accent-muted"
          >
            <span className="hidden sm:inline">{nextChapter.title}</span>
            <span className="sm:hidden">Next</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <Link
            href={`/series/${seriesId}`}
            className="rounded-lg bg-accent px-4 py-2.5 font-medium text-void transition-colors hover:bg-accent-muted"
          >
            Back to series
          </Link>
        )}
      </div>
    </div>
  );
}
