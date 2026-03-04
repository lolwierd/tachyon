"use client";

import { cn } from "@/lib/utils";
import { LayoutList, LayoutGrid } from "lucide-react";

interface ViewToggleProps {
    view: "index" | "grid";
    onChange: (view: "index" | "grid") => void;
    className?: string;
}

export function ViewToggle({ view, onChange, className }: ViewToggleProps) {
    return (
        <div
            className={cn("inline-flex rounded-sm border border-border", className)}
            role="radiogroup"
            aria-label="View mode"
        >
            <button
                type="button"
                role="radio"
                aria-checked={view === "index"}
                onClick={() => onChange("index")}
                className={cn(
                    "inline-flex items-center justify-center px-2.5 py-1.5 text-xs transition-colors duration-150",
                    view === "index"
                        ? "bg-surface-raised text-text"
                        : "text-text-faint hover:text-text-muted",
                )}
            >
                <LayoutList className="h-3.5 w-3.5" />
            </button>
            <button
                type="button"
                role="radio"
                aria-checked={view === "grid"}
                onClick={() => onChange("grid")}
                className={cn(
                    "inline-flex items-center justify-center px-2.5 py-1.5 text-xs transition-colors duration-150",
                    view === "grid"
                        ? "bg-surface-raised text-text"
                        : "text-text-faint hover:text-text-muted",
                )}
            >
                <LayoutGrid className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
