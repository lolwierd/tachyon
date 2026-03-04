"use client";

import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Tooltip text shown on hover */
    label: string;
    /** Visual size */
    size?: "sm" | "md";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
    ({ className, label, size = "md", children, ...props }, ref) => {
        return (
            <button
                ref={ref}
                type="button"
                title={label}
                aria-label={label}
                className={cn(
                    "inline-flex items-center justify-center rounded-sm text-text-muted transition-colors duration-150",
                    "hover:bg-surface-hover hover:text-text",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                    size === "sm" ? "h-7 w-7" : "h-9 w-9",
                    className,
                )}
                {...props}
            >
                {children}
            </button>
        );
    },
);

IconButton.displayName = "IconButton";
