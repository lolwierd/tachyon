"use client";

import { cn } from "@/lib/utils";
import { Cover } from "@/components/ui/cover";
import Link from "next/link";
import { buildSeriesHref } from "@/lib/reader/url";

interface SeriesGridCardProps {
    sourceId: string;
    title: string;
    coverUrl?: string | null;
    type?: string;
    status?: string;
    source?: string | null;
    currentChapterSourceId?: string | null;
    unreadChapters?: number;
    className?: string;
}

export function SeriesGridCard({
    sourceId,
    title,
    coverUrl,
    type,
    status,
    source,
    unreadChapters = 0,
    className,
}: SeriesGridCardProps) {
    const href = buildSeriesHref(sourceId, source);

    const meta = [type, status].filter(Boolean).join(" · ");

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
            <Cover
                src={coverUrl}
                alt={title}
                className="w-full shadow-sm transition-shadow duration-200 group-hover:shadow-md group-hover:shadow-void/50"
                sizes="(max-width: 640px) 33vw, (max-width: 1024px) 25vw, 200px"
            >
                {unreadChapters > 0 && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-accent px-1.5 py-0.5 font-mono text-[10px] font-medium text-void">
                        {unreadChapters}
                    </span>
                )}
            </Cover>
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
