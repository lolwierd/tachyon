"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";

interface JumpToChapterProps {
    onJump: (chapterNo: number) => void;
    className?: string;
}

export function JumpToChapter({ onJump, className }: JumpToChapterProps) {
    const [value, setValue] = useState("");

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const num = parseFloat(value);
        if (!isNaN(num) && num > 0) {
            onJump(num);
            setValue("");
        }
    };

    return (
        <form onSubmit={handleSubmit} className={cn("relative", className)}>
            <input
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Jump to ch."
                className="w-24 rounded-sm border border-border bg-surface-raised px-2.5 py-1.5 font-mono text-xs text-text placeholder:text-text-faint transition-colors duration-150 focus:border-accent focus:outline-none"
            />
        </form>
    );
}
