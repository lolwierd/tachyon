"use client";

/*
 * The Hanging Rule — a vertical scrobbler shaped like a reading mark on a
 * scroll. At rest it's a 2px ink hairline flush to the right edge with a small
 * cinnabar notch at the current position — a margin rule, not a control. Reach
 * for it (hover / touch) and it blossoms: the rail inflates to a real hit
 * target, page ticks cross it, and a preview chip floats beside the handle.
 * After 1.5s of no contact, it retreats back to a whisper.
 *
 * Why not a YouTube-style seek bar? The app's palette names its accent as 朱色
 * — the personal seal — and the surrounding UI favors restraint (4px
 * scrollbar, thin cinnabar focus rings). A default seek-bar aesthetic would
 * fight that voice. A rectangular cinnabar seal on an ink rule speaks the
 * app's language back to it.
 *
 * Vertical-only by design. Paged (LTR/RTL) modes already have a horizontal
 * range input in the info bar; forcing this metaphor sideways would be
 * dishonest.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { ChapterPage } from "@/lib/sources/types";

interface VerticalScrobblerProps {
  pages: ChapterPage[];
  currentPage: number;
  onScrubTo: (pageIdx: number) => void;
  visible: boolean;
}

// How long after the last interaction before the rail retreats to a whisper.
const RETRACT_AFTER_MS = 1500;

// On very long chapters, render at most this many ticks. A solid wall of
// hairlines reads as noise; thinning them keeps the rail legible as structure.
const MAX_TICKS = 60;

const PREVIEW_W = 84;
const PREVIEW_H = 120;

export function VerticalScrobbler({
  pages,
  currentPage,
  onScrubTo,
  visible,
}: VerticalScrobblerProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const retractTimerRef = useRef<number | null>(null);
  // Cache rail bounds on drag-start to avoid re-reading layout each move.
  const railRectRef = useRef<DOMRect | null>(null);
  const lastScrubbedPageRef = useRef<number>(-1);

  const [blossomed, setBlossomed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragPage, setDragPage] = useState<number | null>(null);

  const pageCount = pages.length;
  const displayPage =
    dragging && dragPage != null
      ? Math.max(0, Math.min(dragPage, Math.max(pageCount - 1, 0)))
      : currentPage;
  const progressPct =
    pageCount > 1 ? (displayPage / (pageCount - 1)) * 100 : 0;

  const clearRetractTimer = useCallback(() => {
    if (retractTimerRef.current != null) {
      window.clearTimeout(retractTimerRef.current);
      retractTimerRef.current = null;
    }
  }, []);

  const scheduleRetract = useCallback(() => {
    clearRetractTimer();
    retractTimerRef.current = window.setTimeout(() => {
      retractTimerRef.current = null;
      setBlossomed(false);
    }, RETRACT_AFTER_MS);
  }, [clearRetractTimer]);

  useEffect(() => clearRetractTimer, [clearRetractTimer]);

  const computePageFromY = useCallback(
    (clientY: number) => {
      const rect = railRectRef.current ?? railRef.current?.getBoundingClientRect();
      if (!rect || pageCount === 0) return 0;
      if (rect.height <= 0) return 0;
      const ratio = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
      return Math.round(ratio * (pageCount - 1));
    },
    [pageCount],
  );

  const scrubIfChanged = useCallback(
    (pageIdx: number) => {
      if (pageIdx === lastScrubbedPageRef.current) return;
      lastScrubbedPageRef.current = pageIdx;
      onScrubTo(pageIdx);
    },
    [onScrubTo],
  );

  const handlePointerEnter = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Touch doesn't fire pointerenter without pointerdown, so this is a
      // mouse/stylus hover path only. Good — we don't want to auto-blossom on
      // every incidental edge-swipe on mobile.
      if (event.pointerType === "touch") return;
      clearRetractTimer();
      setBlossomed(true);
    },
    [clearRetractTimer],
  );

  const handlePointerLeave = useCallback(() => {
    if (dragging) return;
    scheduleRetract();
  }, [dragging, scheduleRetract]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (pageCount === 0) return;
      if (event.button !== 0 && event.pointerType === "mouse") return;
      const rail = railRef.current;
      if (!rail) return;

      event.preventDefault();
      rail.setPointerCapture(event.pointerId);
      railRectRef.current = rail.getBoundingClientRect();
      clearRetractTimer();
      setBlossomed(true);
      setDragging(true);

      const page = computePageFromY(event.clientY);
      setDragPage(page);
      // Reset so pointer-down always acts, even if the pressed spot already
      // matches the current page (important for tap-to-jump feel).
      lastScrubbedPageRef.current = -1;
      scrubIfChanged(page);
    },
    [clearRetractTimer, computePageFromY, pageCount, scrubIfChanged],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const page = computePageFromY(event.clientY);
      setDragPage((prev) => (prev === page ? prev : page));
      scrubIfChanged(page);
    },
    [computePageFromY, dragging, scrubIfChanged],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const rail = railRef.current;
      if (rail && rail.hasPointerCapture(event.pointerId)) {
        rail.releasePointerCapture(event.pointerId);
      }
      setDragging(false);
      setDragPage(null);
      railRectRef.current = null;
      // For mouse, the cursor is still over the rail after release — let
      // pointerleave schedule the retract when they actually move away.
      // Touch/pen have no hover state, so retract immediately.
      if (event.pointerType !== "mouse") scheduleRetract();
    },
    [dragging, scheduleRetract],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (pageCount === 0) return;
      let next: number | null = null;
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = currentPage - 1;
      else if (event.key === "ArrowDown" || event.key === "ArrowRight") next = currentPage + 1;
      else if (event.key === "PageUp") next = currentPage - 5;
      else if (event.key === "PageDown") next = currentPage + 5;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = pageCount - 1;
      if (next == null) return;
      // The reader's window-level keydown treats arrows as viewport scroll;
      // stopping propagation here keeps those two behaviors from stacking.
      event.preventDefault();
      event.stopPropagation();
      const clamped = Math.min(Math.max(next, 0), pageCount - 1);
      clearRetractTimer();
      setBlossomed(true);
      lastScrubbedPageRef.current = -1;
      scrubIfChanged(clamped);
      scheduleRetract();
    },
    [clearRetractTimer, currentPage, pageCount, scheduleRetract, scrubIfChanged],
  );

  const tickIndices = useMemo(() => {
    if (pageCount === 0) return [] as number[];
    if (pageCount <= MAX_TICKS) return Array.from({ length: pageCount }, (_, i) => i);
    const step = Math.ceil(pageCount / MAX_TICKS);
    const result: number[] = [];
    for (let i = 0; i < pageCount; i += step) result.push(i);
    if (result[result.length - 1] !== pageCount - 1) result.push(pageCount - 1);
    return result;
  }, [pageCount]);

  if (!visible || pageCount === 0) return null;

  const previewSource =
    dragging && dragPage != null ? pages[dragPage] : null;

  return (
    <div
      className="pointer-events-none fixed right-0 z-[75] flex"
      // Breathing room top & bottom so the rail reads like an intentional
      // margin rule rather than a chrome element hugging the viewport edges.
      // Also keeps it clear of the info bars when the user pops them open.
      style={{ top: "5rem", bottom: "5rem" }}
    >
      {previewSource ? (
        <div
          className={cn(
            "pointer-events-none absolute flex -translate-y-1/2 items-center gap-2",
            "rounded-sm border border-border bg-surface-raised/95 p-1.5 shadow-xl backdrop-blur-sm",
          )}
          style={{
            top: `${progressPct}%`,
            // The preview floats to the LEFT of the rail. right: 2rem clears
            // the 24px rail hit zone with a small gap.
            right: "2rem",
          }}
        >
          <div
            className="relative shrink-0 overflow-hidden rounded-[2px] border-l-2 border-accent bg-void"
            style={{ width: PREVIEW_W, height: PREVIEW_H }}
          >
            <Image
              src={previewSource.imageUrl}
              alt=""
              width={PREVIEW_W}
              height={PREVIEW_H}
              className="h-full w-full object-cover"
              unoptimized
            />
          </div>
          <div className="flex flex-col items-end pr-1">
            <span className="font-mono text-sm tabular-nums text-text">
              {displayPage + 1}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-text-faint">
              of {pageCount}
            </span>
          </div>
        </div>
      ) : null}

      {/* The rail — a 24px hit zone containing a 2px ink line that blossoms on reach */}
      <div
        ref={railRef}
        role="slider"
        tabIndex={0}
        aria-label="Reading position"
        aria-valuemin={1}
        aria-valuemax={pageCount}
        aria-valuenow={displayPage + 1}
        aria-valuetext={`Page ${displayPage + 1} of ${pageCount}`}
        aria-orientation="vertical"
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          clearRetractTimer();
          setBlossomed(true);
        }}
        onBlur={() => {
          if (!dragging) scheduleRetract();
        }}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "pointer-events-auto relative h-full w-6 cursor-pointer select-none touch-none",
        )}
        style={{ WebkitTapHighlightColor: "transparent" }}
      >
        {/* Ink rule — hairline at rest, inflates to a soft plate when blossomed */}
        <div
          className={cn(
            "absolute right-0 top-0 bottom-0 transition-all duration-200 ease-out",
            blossomed
              ? "w-6 rounded-l-sm border-l border-border-subtle bg-surface-raised/70 backdrop-blur-sm"
              : "w-[2px] bg-border-subtle",
          )}
          aria-hidden
        />

        {/* Page ticks — faint hairlines crossing the rail when blossomed */}
        {blossomed
          ? tickIndices.map((idx) => {
              const top = pageCount > 1 ? (idx / (pageCount - 1)) * 100 : 0;
              return (
                <div
                  key={idx}
                  className="absolute right-0 h-px w-2 bg-border"
                  style={{ top: `${top}%` }}
                  aria-hidden
                />
              );
            })
          : null}

        {/* The cinnabar seal — rectangular notch, not a circle. Echoes the hanko. */}
        <div
          className={cn(
            "absolute right-0 rounded-l-[1px] bg-accent transition-all duration-200 ease-out",
            blossomed ? "h-2.5 w-6 shadow-[0_0_0_1px_var(--color-accent-muted)]" : "h-2 w-1",
          )}
          style={{ top: `${progressPct}%`, transform: "translateY(-50%)" }}
          aria-hidden
        />
      </div>
    </div>
  );
}
