"use client";

import { cn } from "@/lib/utils";
import { buildReaderHref } from "@/lib/reader/url";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { Check, CheckCheck, BookOpen, MoreVertical } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";

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
    className?: string;
    trailing?: ReactNode;
    onMarkRead?: () => void;
    onMarkUnread?: () => void;
    onMarkReadUpTo?: () => void;
}

export function ChapterListItem({
    seriesId,
    seriesSource,
    chapterId,
    chapterNo,
    title,
    readState = "unread",
    isCurrent = false,
    className,
    trailing,
    onMarkRead,
    onMarkUnread,
    onMarkReadUpTo,
    ...rest
}: ChapterListItemProps) {
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
                "group relative flex items-center gap-2 px-3 py-2.5 transition-colors duration-150",
                "hover:bg-surface-raised",
                isCurrent && "bg-accent-faint",
                className,
            )}
        >
            <Link
                href={buildReaderHref(seriesId, chapterId, seriesSource)}
                className="flex min-w-0 flex-1 items-center gap-4"
            >
                <span
                    className={cn(
                        "w-14 shrink-0 text-right font-mono text-base tabular-nums",
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
                            className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-sm border border-border bg-surface py-1 shadow-lg"
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
