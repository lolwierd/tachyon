"use client";

import { cn } from "@/lib/utils";
import { useCallback } from "react";

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
    const advance = useCallback(() => {
        onAdvance();
    }, [onAdvance]);

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

            <p className="mt-6 text-xs text-text-faint">
                Tap anywhere or press any key to continue
            </p>
        </div>
    );
}
