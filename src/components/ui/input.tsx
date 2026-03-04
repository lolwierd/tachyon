"use client";

import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Render an icon on the left side */
  icon?: React.ReactNode;
  /** Use the underline-only style (no border box) */
  variant?: "default" | "underline";
}

export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(
  ({ className, icon, variant = "default", ...props }, ref) => {
    const isUnderline = variant === "underline";

    return (
      <div className="relative">
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint transition-colors">
            {icon}
          </span>
        )}
        <input
          ref={ref}
          className={cn(
            "w-full bg-transparent text-sm text-text placeholder:text-text-faint transition-colors duration-150",
            icon ? "pl-10" : "pl-3",
            "pr-3",
            isUnderline
              ? "border-b border-border-subtle py-3.5 focus:border-accent focus:outline-none"
              : "rounded-sm border border-border bg-surface-raised py-2.5 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30",
            className,
          )}
          {...props}
        />
      </div>
    );
  },
);

InputField.displayName = "InputField";
