"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { buildReaderHref } from "@/lib/reader/url";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { Check, CheckCheck, BookOpen, MoreVertical } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import {
    LAMP_CSS_VAR,
    LAMP_TEXT_CLASS,
    formatAbsolute,
    formatRelative,
    lampFromPublishedAt,
} from "@/lib/ui/freshness";

interface ChapterListItemProps extends HTMLAttributes<HTMLDivElement> {
    seriesId: string;
    seriesSource?: string | null;
    chapterId: string;
    chapterNo: number;
    title?: string;
    /** "read" | "unread" | "in-progress" */
    readState?: "read" | "unread" | "in-progress";
    /** Whether this is the current chapter the user is reading */
    isCurrent?: boolean;
    /** Unix ms when the chapter was published on its source. Null/undefined when unknown. */
    publishedAt?: number | null;
    className?: string;
    trailing?: ReactNode;
    onMarkRead?: () => void;
    onMarkUnread?: () => void;
    onMarkReadUpTo?: () => void;
}

function ChapterListItemInner({
    seriesId,
    seriesSource,
    chapterId,
    chapterNo,
    title,
    readState = "unread",
    isCurrent = false,
    publishedAt,
    className,
    trailing,
    onMarkRead,
    onMarkUnread,
    onMarkReadUpTo,
    ...rest
}: ChapterListItemProps) {
    const lamp = lampFromPublishedAt(publishedAt ?? null);
    const relative = formatRelative(publishedAt ?? null);
    const absolute = formatAbsolute(publishedAt ?? null);
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const hasActions = !!(onMarkRead || onMarkUnread || onMarkReadUpTo);

    useEffect(() => {
        if (!menuOpen) return;
        function handleClick(e: MouseEvent | TouchEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        }
        function handleKey(e: KeyboardEvent) {
            if (e.key === "Escape") setMenuOpen(false);
        }
        document.addEventListener("mousedown", handleClick);
        document.addEventListener("touchstart", handleClick);
        document.addEventListener("keydown", handleKey);
        return () => {
            document.removeEventListener("mousedown", handleClick);
            document.removeEventListener("touchstart", handleClick);
            document.removeEventListener("keydown", handleKey);
        };
    }, [menuOpen]);

    return (
        <div
            {...rest}
            className={cn(
                "group relative flex items-center gap-2 px-2 py-1.5 sm:px-3 sm:py-2.5 transition-colors duration-150",
                "hover:bg-surface-raised",
                isCurrent && "bg-accent-faint",
                className,
            )}
        >
            {/* Freshness edge — a 2px bar along the left of the row, colored by
                publish recency. Past ~4 weeks (or no date) the bar is absent;
                silence IS the signal. Fades with the row when the chapter is read. */}
            {lamp ? (
                <span
                    aria-hidden
                    className={cn(
                        "pointer-events-none absolute inset-y-0 left-0 w-[2px]",
                        readState === "read" && "opacity-40",
                    )}
                    style={{ background: LAMP_CSS_VAR[lamp] }}
                />
            ) : null}

            <Link
                href={buildReaderHref(seriesId, chapterId, seriesSource)}
                className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3"
            >
                {/* Chapter number, title, and relative date are all on the
                    same visual tier — the number is the index, the title
                    is the name, the date is the stamp. Before, the number
                    jumped to text-base on sm+ while the title stayed at
                    text-sm — a 2px mismatch that made the row feel like
                    it had two typographic temperatures. Unified at
                    text-sm so the eye reads across cleanly. */}
                <span
                    className={cn(
                        "w-10 shrink-0 text-right font-mono text-sm tabular-nums sm:w-14",
                        isCurrent ? "text-accent font-medium" : "text-text",
                    )}
                >
                    {chapterNo % 1 === 0 ? chapterNo.toFixed(0) : chapterNo.toString()}
                </span>

                <span
                    className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        readState === "unread" && "bg-accent",
                        readState === "read" && "bg-text-faint",
                        readState === "in-progress" && "bg-accent/50",
                    )}
                />

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

                {relative ? (
                    <span
                        title={absolute ?? undefined}
                        className={cn(
                            "shrink-0 font-mono text-[11px] tabular-nums",
                            lamp ? LAMP_TEXT_CLASS[lamp] : "text-text-faint",
                        )}
                    >
                        {relative}
                    </span>
                ) : null}
            </Link>

            {trailing ? <div className="shrink-0">{trailing}</div> : null}

            {/* Menu toggle */}
            {hasActions && (
                <div className="relative shrink-0">
                    <button
                        type="button"
                        onClick={() => setMenuOpen((v) => !v)}
                        className="rounded-sm p-1.5 text-text-faint transition-colors hover:bg-surface-raised hover:text-text-muted"
                        aria-label="Chapter actions"
                    >
                        <MoreVertical className="h-3.5 w-3.5" />
                    </button>

                    {menuOpen && (
                        <div
                            ref={menuRef}
                            className="absolute right-0 top-full z-50 mt-1 min-w-[200px] max-w-[calc(100vw-2rem)] rounded-sm border border-border bg-surface py-1 shadow-lg"
                        >
                            {readState !== "read" && onMarkRead && (
                                <button
                                    type="button"
                                    onClick={() => { onMarkRead(); setMenuOpen(false); }}
                                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                                >
                                    <Check className="h-3.5 w-3.5" />
                                    Mark as read
                                </button>
                            )}
                            {readState !== "unread" && onMarkUnread && (
                                <button
                                    type="button"
                                    onClick={() => { onMarkUnread(); setMenuOpen(false); }}
                                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                                >
                                    <BookOpen className="h-3.5 w-3.5" />
                                    Mark as unread
                                </button>
                            )}
                            {onMarkReadUpTo && (
                                <button
                                    type="button"
                                    onClick={() => { onMarkReadUpTo(); setMenuOpen(false); }}
                                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                                >
                                    <CheckCheck className="h-3.5 w-3.5" />
                                    Mark up to here as read
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// Memoised — the parent series page polls worker state every ~4s and
// re-renders. Without memo, every poll tick re-renders every chapter
// row in a list that can exceed 500 items. Note: callers must pass
// stable function refs (useCallback) for onMarkRead / onMarkUnread
// / onMarkReadUpTo for the memo to actually skip; inline arrows at
// the call site defeat it.
export const ChapterListItem = memo(ChapterListItemInner);
