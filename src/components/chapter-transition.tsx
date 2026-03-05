"use client";

import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface ChapterTransitionProps {
    completedTitle: string;
    nextTitle: string;
    onAdvance: () => void;
    className?: string;
}

export function ChapterTransition({
    completedTitle,
    nextTitle,
    onAdvance,
    className,
}: ChapterTransitionProps) {
    const [overscrollDistance, setOverscrollDistance] = useState(0);
    const overscrollDistanceRef = useRef(0);
    const touchStartY = useRef<number | null>(null);
    const advancedRef = useRef(false);
    const resetTimeoutRef = useRef<number | null>(null);
    const OVERSCROLL_THRESHOLD = 220;

    const advance = useCallback(() => {
        if (advancedRef.current) return;
        advancedRef.current = true;
        onAdvance();
    }, [onAdvance]);

    const clearResetTimer = useCallback(() => {
        if (resetTimeoutRef.current != null) {
            window.clearTimeout(resetTimeoutRef.current);
            resetTimeoutRef.current = null;
        }
    }, []);

    const scheduleReset = useCallback(() => {
        clearResetTimer();
        resetTimeoutRef.current = window.setTimeout(() => {
            overscrollDistanceRef.current = 0;
            setOverscrollDistance(0);
            resetTimeoutRef.current = null;
        }, 280);
    }, [clearResetTimer]);

    const handleOverscrollDelta = useCallback(
        (delta: number) => {
            if (advancedRef.current) return;
            if (delta <= 0) {
                scheduleReset();
                return;
            }
            clearResetTimer();
            const next = Math.max(
                0,
                Math.min(OVERSCROLL_THRESHOLD, overscrollDistanceRef.current + delta),
            );
            overscrollDistanceRef.current = next;
            setOverscrollDistance(next);
            if (next >= OVERSCROLL_THRESHOLD) advance();
        },
        [advance, clearResetTimer, scheduleReset],
    );

    const pullProgress = useMemo(
        () => Math.round((Math.min(overscrollDistance, OVERSCROLL_THRESHOLD) / OVERSCROLL_THRESHOLD) * 100),
        [overscrollDistance],
    );

    useEffect(() => {
        return () => {
            if (resetTimeoutRef.current != null) {
                window.clearTimeout(resetTimeoutRef.current);
            }
        };
    }, []);

    return (
        <div
            className={cn(
                "flex min-h-[60vh] cursor-pointer touch-manipulation flex-col items-center justify-center gap-6 px-6 py-20",
                className,
            )}
            onPointerUp={(e) => {
                e.stopPropagation();
                advance();
            }}
            onWheel={(e) => {
                if (e.deltaY <= 0) return;
                handleOverscrollDelta(e.deltaY);
            }}
            onTouchStart={(e) => {
                touchStartY.current = e.touches[0]?.clientY ?? null;
            }}
            onTouchMove={(e) => {
                const currentY = e.touches[0]?.clientY;
                if (touchStartY.current == null || currentY == null) return;
                const delta = touchStartY.current - currentY;
                touchStartY.current = currentY;
                handleOverscrollDelta(delta);
            }}
            onTouchEnd={() => {
                touchStartY.current = null;
                scheduleReset();
            }}
            onKeyDown={(e) => {
                if (e.key === "Tab" || e.metaKey || e.ctrlKey || e.altKey) return;
                e.preventDefault();
                advance();
            }}
            role="button"
            tabIndex={0}
            aria-label={`Advance to ${nextTitle}`}
        >
            <p className="text-sm font-medium uppercase tracking-widest text-text-faint">
                Chapter complete
            </p>
            <p className="max-w-lg text-center font-display text-2xl text-text-muted">
                {completedTitle}
            </p>

            <div className="relative my-4 w-32">
                <div className="h-px w-full bg-border-subtle" />
            </div>

            <p className="text-xs font-medium uppercase tracking-widest text-text-faint">
                Next
            </p>
            <p className="max-w-lg text-center font-display text-3xl italic text-text">
                {nextTitle}
            </p>

            <div className="mt-6 flex w-full max-w-xs flex-col gap-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-border-subtle">
                    <div
                        className="h-full bg-accent transition-[width] duration-150 ease-out"
                        style={{ width: `${pullProgress}%` }}
                    />
                </div>
                <p className="text-center text-xs text-text-faint">
                    Pull up to continue ({pullProgress}%)
                </p>
            </div>
            <p className="text-xs text-text-faint">
                Tap anywhere or press any key to continue
            </p>
        </div>
    );
}
