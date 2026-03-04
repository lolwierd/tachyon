"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Loader2,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChapterPage, Chapter } from "@/lib/sources/types";

export function ReaderView({
  seriesId,
  chapterId,
}: {
  seriesId: string;
  chapterId: string;
}) {
  const router = useRouter();
  const [pages, setPages] = useState<ChapterPage[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUI, setShowUI] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentIdx = chapters.findIndex(
    (c) => c.sourceChapterId === chapterId
  );
  const prevChapter = currentIdx > 0 ? chapters[currentIdx - 1] : null;
  const nextChapter =
    currentIdx < chapters.length - 1 ? chapters[currentIdx + 1] : null;
  const currentChapter = currentIdx >= 0 ? chapters[currentIdx] : null;

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [pagesRes, chaptersRes] = await Promise.all([
          fetch(`/api/chapters/${chapterId}/pages`),
          fetch(`/api/series/${seriesId}/chapters`),
        ]);
        if (pagesRes.ok) setPages(await pagesRes.json());
        if (chaptersRes.ok) setChapters(await chaptersRes.json());
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [chapterId, seriesId]);

  // Scroll to top when chapter changes
  useEffect(() => {
    containerRef.current?.scrollTo(0, 0);
  }, [chapterId]);

  const goToPrev = useCallback(() => {
    if (prevChapter) {
      router.push(`/read/${seriesId}/${prevChapter.sourceChapterId}`);
    }
  }, [prevChapter, seriesId, router]);

  const goToNext = useCallback(() => {
    if (nextChapter) {
      router.push(`/read/${seriesId}/${nextChapter.sourceChapterId}`);
    }
  }, [nextChapter, seriesId, router]);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") goToPrev();
      if (e.key === "ArrowRight") goToNext();
      if (e.key === "Escape") setShowUI((v) => !v);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goToPrev, goToNext]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-void">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative min-h-dvh bg-void"
    >
      {/* ── Top bar (appears on hover/tap) ── */}
      <div
        className={cn(
          "fixed inset-x-0 top-0 z-50 flex items-center justify-between border-b border-border/30 bg-void/90 px-4 py-3 backdrop-blur-lg transition-all duration-300",
          showUI
            ? "translate-y-0 opacity-100"
            : "-translate-y-full opacity-0"
        )}
      >
        <Link
          href={`/series/${seriesId}`}
          className="flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back to series</span>
        </Link>

        <span className="text-sm font-medium text-text">
          {currentChapter?.title || `Chapter`}
        </span>

        <div className="w-16" />
      </div>

      {/* ── Toggle UI button ── */}
      <button
        onClick={() => setShowUI((v) => !v)}
        className="fixed right-4 top-4 z-[60] rounded-full bg-surface/80 p-2 text-text-muted backdrop-blur-sm transition-colors hover:bg-surface-raised hover:text-text"
        aria-label="Toggle UI"
      >
        {showUI ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {/* ── Pages (vertical scroll / long strip) ── */}
      <div className="mx-auto max-w-3xl">
        {pages.map((page) => (
          <div key={page.index} className="relative w-full">
            <Image
              src={page.imageUrl}
              alt={`Page ${page.index + 1}`}
              width={800}
              height={1200}
              sizes="(max-width: 768px) 100vw, 768px"
              className="h-auto w-full"
              priority={page.index < 3}
              unoptimized
            />
          </div>
        ))}
      </div>

      {/* ── Chapter navigation (bottom) ── */}
      <div className="mx-auto flex max-w-3xl items-center justify-between border-t border-border/30 px-4 py-6">
        {prevChapter ? (
          <button
            onClick={goToPrev}
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-text transition-colors hover:border-accent-muted hover:text-accent"
          >
            <ChevronLeft className="h-4 w-4" />
            {prevChapter.title}
          </button>
        ) : (
          <div />
        )}

        {nextChapter ? (
          <button
            onClick={goToNext}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-void transition-colors hover:bg-accent-muted"
          >
            {nextChapter.title}
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <Link
            href={`/series/${seriesId}`}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-void transition-colors hover:bg-accent-muted"
          >
            Back to series
          </Link>
        )}
      </div>
    </div>
  );
}
