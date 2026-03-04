"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";

interface ChapterListItemProps {
    seriesId: string;
    chapterId: string;
    chapterNo: number;
    title?: string;
    /** "read" | "unread" | "in-progress" */
    readState?: "read" | "unread" | "in-progress";
    /** Whether this is the current chapter the user is reading */
    isCurrent?: boolean;
    className?: string;
}

export function ChapterListItem({
    seriesId,
    chapterId,
    chapterNo,
    title,
    readState = "unread",
    isCurrent = false,
    className,
}: ChapterListItemProps) {
    return (
        <Link
            href={`/read/${seriesId}/${chapterId}`}
            className={cn(
                "group flex items-center gap-4 px-3 py-2.5 transition-colors duration-150",
                "hover:bg-surface-raised",
                isCurrent && "bg-accent-faint",
                className,
            )}
        >
            {/* Chapter number — the visual anchor */}
            <span
                className={cn(
                    "w-14 shrink-0 text-right font-mono text-base tabular-nums",
                    isCurrent ? "text-accent font-medium" : "text-text",
                )}
            >
                {chapterNo % 1 === 0 ? chapterNo.toFixed(0) : chapterNo.toString()}
            </span>

            {/* Read state dot */}
            <span
                className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    readState === "unread" && "bg-accent",
                    readState === "read" && "bg-text-faint",
                    readState === "in-progress" && "bg-accent/50",
                )}
            />

            {/* Chapter title */}
            <span
                className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    isCurrent
                        ? "text-text"
                        : readState === "read"
                            ? "text-text-faint"
                            : "text-text-muted",
                )}
            >
                {title || `Chapter ${chapterNo}`}
            </span>
        </Link>
    );
}
