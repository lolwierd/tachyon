"use client";

import { cn } from "@/lib/utils";
import { Cover } from "@/components/ui/cover";
import { StatusDot } from "@/components/ui/status-dot";
import Link from "next/link";
import { buildSeriesHref } from "@/lib/reader/url";

interface SeriesListItemProps {
    sourceId: string;
    source?: string | null;
    title: string;
    coverUrl?: string | null;
    status?: string;
    currentChapterSourceId?: string | null;
    currentChapterTitle?: string | null;
    currentPage?: number | null;
    totalChapters?: number;
    completedChapters?: number;
    unreadChapters?: number;
    lastReadAt?: string | null;
    className?: string;
}

export function SeriesListItem({
    sourceId,
    source,
    title,
    coverUrl,
    status,
    totalChapters = 0,
    completedChapters = 0,
    unreadChapters = 0,
    lastReadAt,
    className,
}: SeriesListItemProps) {
    const href = buildSeriesHref(sourceId, source);

    const progressText =
        totalChapters > 0
            ? `Ch. ${completedChapters}/${totalChapters}`
            : completedChapters > 0
                ? `Ch. ${completedChapters}`
                : null;

    const relativeDate = lastReadAt ? formatRelative(lastReadAt) : null;

    return (
        <Link
            href={href}
            className={cn(
                "group flex items-center gap-3 px-3 py-2 transition-colors duration-150",
                "even:bg-surface odd:bg-transparent",
                "hover:bg-surface-raised",
                className,
            )}
        >
            <Cover src={coverUrl} alt={title} className="h-12 w-8 shrink-0">
                {unreadChapters > 0 && (
                    <span className="absolute right-0.5 top-0.5 rounded-full bg-accent px-1 py-0.5 font-mono text-[9px] font-medium text-void">
                        {unreadChapters}
                    </span>
                )}
            </Cover>

            <span className="min-w-0 flex-1 truncate text-sm font-medium text-text group-hover:text-accent transition-colors duration-150">
                {title}
            </span>

            {status && <StatusDot status={status} className="shrink-0" />}

            {progressText && (
                <span className="shrink-0 font-mono text-xs text-text-muted">
                    {progressText}
                </span>
            )}

            {relativeDate && (
                <span className="hidden shrink-0 font-mono text-xs text-text-faint sm:block">
                    {relativeDate}
                </span>
            )}
        </Link>
    );
}

function formatRelative(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "today";
    if (diffDays === 1) return "1d ago";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
}
