import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "bg-surface-raised text-text-muted",
        accent: "bg-accent-faint text-accent",
        status: "bg-surface-raised text-text-faint",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
  VariantProps<typeof badgeVariants> { }

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
