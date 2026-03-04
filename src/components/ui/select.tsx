"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { forwardRef } from "react";

type SelectDropdownProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const SelectDropdown = forwardRef<
    HTMLSelectElement,
    SelectDropdownProps
>(({ className, children, ...props }, ref) => {
    return (
        <div className="relative">
            <select
                ref={ref}
                className={cn(
                    "w-full appearance-none rounded-sm border border-border bg-surface-raised py-2.5 pl-3 pr-8 text-sm text-text transition-colors duration-150",
                    "focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30",
                    className,
                )}
                {...props}
            >
                {children}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
        </div>
    );
});

SelectDropdown.displayName = "SelectDropdown";
