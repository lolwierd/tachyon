import { type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type InputProps = ComponentProps<"input"> & {
  icon?: ReactNode;
};

export function Input({ icon, className, ...props }: InputProps) {
  return (
    <div className="relative">
      {icon && (
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-text-faint">
          {icon}
        </div>
      )}
      <input
        className={cn(
          "w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text placeholder:text-text-faint",
          "transition-colors duration-200",
          "hover:border-surface-hover",
          "focus:border-accent-muted focus:ring-2 focus:ring-accent-faint focus:outline-none",
          icon && "pl-10",
          className,
        )}
        {...props}
      />
    </div>
  );
}
