"use client";

import { cn } from "@/lib/utils";
import { Cover } from "@/components/ui/cover";
import Link from "next/link";

interface SeriesGridCardProps {
    sourceId: string;
    title: string;
    coverUrl?: string | null;
    type?: string;
    status?: string;
    currentChapterSourceId?: string | null;
    className?: string;
}

export function SeriesGridCard({
    sourceId,
    title,
    coverUrl,
    type,
    status,
    currentChapterSourceId,
    className,
}: SeriesGridCardProps) {
    const href = `/series/${sourceId}`;

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
            />
            <div className="mt-1.5 space-y-0.5">
                <p className="line-clamp-2 text-sm font-medium leading-snug text-text group-hover:text-accent transition-colors duration-150">
                    {title}
                </p>
                {meta && (
                    <p className="truncate text-xs text-text-faint">{meta}</p>
                )}
            </div>
        </Link>
    );
}
