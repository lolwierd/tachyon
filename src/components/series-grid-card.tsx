"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { Cover } from "@/components/ui/cover";
import Link from "next/link";
import { buildCoverSrc, buildSeriesHref } from "@/lib/reader/url";
import { LAMP_CSS_VAR, lampFromPublishedAt } from "@/lib/ui/freshness";

const STATUS_COLORS: Record<string, string> = {
    reading: "bg-reading",
    completed: "bg-completed",
    paused: "bg-paused",
    dropped: "bg-dropped",
    planning: "bg-planning",
    rereading: "bg-rereading",
};

interface SeriesGridCardProps {
    sourceId: string;
    title: string;
    coverUrl?: string | null;
    type?: string;
    status?: string;
    source?: string | null;
    currentChapterSourceId?: string | null;
    unreadChapters?: number;
    totalChapters?: number;
    completedChapters?: number;
    /** Unix ms of the newest chapter's publish date on this series. */
    latestChapterPublishedAt?: number | null;
    className?: string;
}

function SeriesGridCardInner({
    sourceId,
    title,
    coverUrl,
    type,
    status,
    source,
    unreadChapters = 0,
    totalChapters = 0,
    completedChapters = 0,
    latestChapterPublishedAt = null,
    className,
}: SeriesGridCardProps) {
    const href = buildSeriesHref(sourceId, source);

    const proxiedCoverUrl = coverUrl?.startsWith("http")
        ? buildCoverSrc(coverUrl, source)
        : coverUrl;

    const meta = [type, status].filter(Boolean).join(" · ");
    const progress = totalChapters > 0 ? completedChapters / totalChapters : 0;
    const statusColor = status ? STATUS_COLORS[status] : null;
    // A fresh-update tick only when there's at least one unread chapter AND
    // the newest chapter is young enough to produce a lamp. Absence of tick =
    // "caught up" OR "we don't know when anything was published."
    const updateLamp = unreadChapters > 0 ? lampFromPublishedAt(latestChapterPublishedAt) : null;

    return (
        <Link
            href={href}
            className={cn(
                "group flex flex-col transition-transform duration-200",
                "hover:-translate-y-0.5",
                className,
            )}
            draggable={false}
        >
            <div className="relative">
                <Cover
                    src={proxiedCoverUrl}
                    alt={title}
                    className="w-full shadow-sm transition-shadow duration-200 group-hover:shadow-md group-hover:shadow-void/50"
                    sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 200px"
                >
                    {unreadChapters > 0 && (
                        <span className="absolute right-1.5 top-1.5 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[10px] font-medium text-void">
                            {unreadChapters}
                        </span>
                    )}
                    {/* Freshness tick: a 2px warm edge along the top of the cover,
                        mirroring the bar on chapter rows. Only present when there's
                        a fresh unread chapter. */}
                    {updateLamp && (
                        <span
                            aria-hidden
                            className="pointer-events-none absolute inset-x-0 top-0 h-[2px]"
                            style={{ background: LAMP_CSS_VAR[updateLamp] }}
                        />
                    )}
                </Cover>
                {/* Progress bar at bottom of cover */}
                {progress > 0 && progress < 1 && (
                    <div className="absolute inset-x-0 bottom-0 h-0.5 bg-border-subtle">
                        <div
                            className="h-full bg-accent transition-[width] duration-300"
                            style={{ width: `${progress * 100}%` }}
                        />
                    </div>
                )}
                {/* Status bar */}
                {statusColor && (
                    <div className={cn("absolute inset-x-0 bottom-0 h-[2px]", statusColor, progress > 0 && progress < 1 && "bottom-0.5")} />
                )}
            </div>
            <div className="mt-1.5 space-y-0.5">
                <p className="line-clamp-2 text-sm font-medium leading-snug text-text group-hover:text-accent transition-colors duration-150">
                    {title}
                </p>
                {meta && (
                    <p className="truncate text-xs text-text-faint">{meta}</p>
                )}
                {source && (
                    <p className="truncate text-[10px] font-medium uppercase tracking-wide text-accent">{source}</p>
                )}
            </div>
        </Link>
    );
}

// Memoised because this component is rendered in the library grid,
// often a few hundred at a time. Library-level state updates (filter,
// sort, tab changes) re-render the parent; without memo every card
// re-renders for nothing. All props are shallow primitives or strings,
// so the default shallow compare is the right equality.
export const SeriesGridCard = memo(SeriesGridCardInner);
