"use client";

import { cn } from "@/lib/utils";

interface FilterChipsProps {
    options: { value: string; label: string; color?: string }[];
    selected: Set<string>;
    onChange: (selected: Set<string>) => void;
    className?: string;
}

export function FilterChips({
    options,
    selected,
    onChange,
    className,
}: FilterChipsProps) {
    const toggle = (value: string) => {
        const next = new Set(selected);
        if (next.has(value)) {
            next.delete(value);
        } else {
            next.add(value);
        }
        onChange(next);
    };

    return (
        <div className={cn("flex flex-wrap gap-1.5", className)}>
            {options.map((opt) => {
                const active = selected.has(opt.value);
                return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => toggle(opt.value)}
                        className={cn(
                            "rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150",
                            active
                                ? "bg-accent-faint text-accent"
                                : "bg-surface-raised text-text-muted hover:bg-surface-hover hover:text-text",
                        )}
                    >
                        {opt.color && (
                            <span
                                className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: opt.color }}
                            />
                        )}
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}
