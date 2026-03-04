"use client";

import { cn } from "@/lib/utils";
import { useEffect, useState, useCallback } from "react";

interface ChapterTransitionProps {
    completedTitle: string;
    nextTitle: string;
    onAdvance: () => void;
    /** Auto-advance delay in ms. 0 = no auto-advance. */
    autoAdvanceMs?: number;
    className?: string;
}

export function ChapterTransition({
    completedTitle,
    nextTitle,
    onAdvance,
    autoAdvanceMs = 1500,
    className,
}: ChapterTransitionProps) {
    const [progress, setProgress] = useState(0);
    const reducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const advance = useCallback(() => {
        onAdvance();
    }, [onAdvance]);

    // Auto-advance timer
    useEffect(() => {
        if (autoAdvanceMs <= 0) return;
        if (reducedMotion) {
            // Immediate advance with reduced motion
            const t = setTimeout(advance, 300);
            return () => clearTimeout(t);
        }

        const interval = 16; // ~60fps
        const steps = autoAdvanceMs / interval;
        let step = 0;

        const timer = setInterval(() => {
            step++;
            setProgress(step / steps);
            if (step >= steps) {
                clearInterval(timer);
                advance();
            }
        }, interval);

        return () => clearInterval(timer);
    }, [autoAdvanceMs, advance, reducedMotion]);

    return (
        <div
            className={cn(
                "flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 py-20",
                className,
            )}
            onClick={advance}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") advance();
            }}
            role="button"
            tabIndex={0}
            aria-label={`Advance to ${nextTitle}`}
        >
            {/* Completed chapter */}
            <p className="text-sm font-medium uppercase tracking-widest text-text-faint">
                Chapter complete
            </p>
            <p className="max-w-lg text-center font-display text-2xl text-text-muted">
                {completedTitle}
            </p>

            {/* Divider with countdown */}
            <div className="relative my-4 w-32">
                <div className="h-px w-full bg-border-subtle" />
                {autoAdvanceMs > 0 && (
                    <div
                        className="absolute left-0 top-0 h-px bg-accent transition-none"
                        style={{ width: `${progress * 100}%` }}
                    />
                )}
            </div>

            {/* Next chapter — italic Instrument Serif for the ceremonial moment */}
            <p className="text-xs font-medium uppercase tracking-widest text-text-faint">
                Next
            </p>
            <p className="max-w-lg text-center font-display text-3xl italic text-text">
                {nextTitle}
            </p>

            <p className="mt-6 text-xs text-text-faint">
                Tap anywhere or press any key to continue
            </p>
        </div>
    );
}
