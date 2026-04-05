"use client";

import { cn } from "@/lib/utils";
import { Cover } from "@/components/ui/cover";
import { ProgressLine } from "@/components/ui/progress-line";
import { buildReaderHref } from "@/lib/reader/url";
import Link from "next/link";
import { useRef, useState, useCallback } from "react";
import { X } from "lucide-react";

export interface MomentumItem {
    seriesId: string;
    seriesSource?: string | null;
    chapterId: string;
    title: string;
    coverUrl?: string | null;
    chapterTitle: string;
    currentPage: number;
    totalChapters: number;
    completedChapters: number;
    progressUpdatedAt?: string | null;
}

function formatRelative(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    const days = Math.floor(diff / 86_400_000);
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
}

interface MomentumRailProps {
    items: MomentumItem[];
    className?: string;
    onRemove?: (seriesId: string) => void;
}

export function MomentumRail({ items, className, onRemove }: MomentumRailProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragState = useRef({ startX: 0, scrollLeft: 0 });

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (!scrollRef.current) return;
        setIsDragging(true);
        dragState.current.startX = e.pageX - scrollRef.current.offsetLeft;
        dragState.current.scrollLeft = scrollRef.current.scrollLeft;
    }, []);

    const handleMouseMove = useCallback(
        (e: React.MouseEvent) => {
            if (!isDragging || !scrollRef.current) return;
            e.preventDefault();
            const x = e.pageX - scrollRef.current.offsetLeft;
            const walk = (x - dragState.current.startX) * 1.5;
            scrollRef.current.scrollLeft = dragState.current.scrollLeft - walk;
        },
        [isDragging],
    );

    const handleMouseUp = useCallback(() => setIsDragging(false), []);

    if (items.length === 0) return null;

    return (
        <div className={cn("relative overflow-hidden", className)}>
            <div
                ref={scrollRef}
                className={cn(
                    "flex gap-3 overflow-x-auto scroll-smooth pb-2 scrollbar-none",
                    "snap-x snap-mandatory",
                    isDragging ? "cursor-grabbing" : "cursor-grab",
                )}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
                {items.map((item) => {
                    const progress =
                        item.totalChapters > 0
                            ? item.completedChapters / item.totalChapters
                            : 0;

                    return (
                        <div
                            key={item.seriesId}
                            className="group relative w-52 shrink-0 snap-start sm:w-60"
                        >
                            {onRemove && (
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onRemove(item.seriesId);
                                    }}
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                    }}
                                    className="absolute right-1 top-1 z-10 rounded-sm bg-surface/90 p-1 text-text-faint opacity-100 transition-colors hover:text-text sm:opacity-0 sm:group-hover:opacity-100"
                                    aria-label={`Remove ${item.title} from continue reading`}
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            )}
                            <Link
                                href={buildReaderHref(item.seriesId, item.chapterId)}
                                className="flex gap-3 rounded-sm p-2 transition-colors duration-150 hover:bg-surface-raised"
                                draggable={false}
                            >
                                <Cover
                                    src={item.coverUrl?.startsWith("http")
                                        ? `/api/media/page?url=${encodeURIComponent(item.coverUrl)}${item.seriesSource ? `&source=${encodeURIComponent(item.seriesSource)}` : ""}`
                                        : item.coverUrl}
                                    alt={item.title}
                                    className="h-16 w-11 shrink-0"
                                />
                                <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                                    <div>
                                        <p className="truncate text-sm font-medium text-text group-hover:text-accent transition-colors duration-150">
                                            {item.title}
                                        </p>
                                        <p className="truncate font-mono text-xs text-text-muted">
                                            {item.chapterTitle} · p.{item.currentPage}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <ProgressLine value={progress} className="flex-1" />
                                        {item.progressUpdatedAt && (
                                            <span className="shrink-0 text-[10px] text-text-faint">
                                                {formatRelative(item.progressUpdatedAt)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </Link>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
