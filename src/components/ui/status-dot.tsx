import { cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
    reading: "bg-reading",
    completed: "bg-completed",
    paused: "bg-paused",
    dropped: "bg-dropped",
    planning: "bg-planning",
    rereading: "bg-rereading",
};

interface StatusDotProps {
    status: string;
    size?: "sm" | "md";
    className?: string;
}

export function StatusDot({ status, size = "sm", className }: StatusDotProps) {
    const colorClass = statusColors[status] ?? "bg-text-faint";
    return (
        <span
            className={cn(
                "inline-block shrink-0 rounded-full",
                size === "sm" ? "h-1.5 w-1.5" : "h-2.5 w-2.5",
                colorClass,
                className,
            )}
            title={status}
            aria-label={`Status: ${status}`}
        />
    );
}
