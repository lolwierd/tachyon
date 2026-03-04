"use client";

import { cn } from "@/lib/utils";
import { Cover } from "@/components/ui/cover";
import { ProgressLine } from "@/components/ui/progress-line";
import Link from "next/link";
import { useRef, useState, useCallback } from "react";

export interface MomentumItem {
    seriesId: string;
    chapterId: string;
    title: string;
    coverUrl?: string | null;
    chapterTitle: string;
    currentPage: number;
    totalChapters: number;
    completedChapters: number;
}

interface MomentumRailProps {
    items: MomentumItem[];
    className?: string;
}

export function MomentumRail({ items, className }: MomentumRailProps) {
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
        <div className={cn("relative", className)}>
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
                        <Link
                            key={item.seriesId}
                            href={`/read/${item.seriesId}/${item.chapterId}`}
                            className="group flex w-60 shrink-0 snap-start gap-3 rounded-sm p-2 transition-colors duration-150 hover:bg-surface-raised"
                            draggable={false}
                        >
                            <Cover
                                src={item.coverUrl}
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
                                <ProgressLine value={progress} />
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
