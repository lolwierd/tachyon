import { cn } from "@/lib/utils";

interface ProgressLineProps {
    /** Value between 0 and 1 */
    value: number;
    className?: string;
}

export function ProgressLine({ value, className }: ProgressLineProps) {
    const pct = Math.min(1, Math.max(0, value)) * 100;
    return (
        <div
            className={cn("h-0.5 w-full overflow-hidden rounded-full bg-border-subtle", className)}
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
        >
            <div
                className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                style={{ width: `${pct}%` }}
            />
        </div>
    );
}
