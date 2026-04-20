"use client";

import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type AnchorHTMLAttributes,
} from "react";
import Link from "next/link";

/**
 * Button tiers, ordered by the *weight* they carry on a page.
 *
 * - `primary`  — the one action the user came for. Cinnabar fill, paper-white
 *                text. The stamp being pressed. Reserve to ≤1 per surface.
 * - `seal`     — bordered cinnabar text. Important but not *the* action.
 *                Feels like the outline of a stamp before it lands.
 * - `secondary`— the workhorse. Thin border, muted text, cinnabar on hover.
 *                Use liberally.
 * - `ghost`    — borderless, text-only. For toolbars, row-level actions, tight
 *                chrome that should disappear when idle.
 * - `danger`   — destructive. Muted until hover; then the removal red blooms.
 */
type Variant = "primary" | "seal" | "secondary" | "ghost" | "danger";
type Size = "xs" | "sm" | "md";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-accent text-[color:var(--color-text-on-accent)] hover:bg-accent-muted",
  seal:
    "border border-accent/50 text-accent hover:border-accent hover:bg-accent-faint",
  secondary:
    "border border-border text-text-muted hover:border-accent hover:text-accent",
  ghost:
    "text-text-muted hover:text-accent",
  danger:
    "border border-border text-dropped hover:border-dropped hover:bg-dropped/10",
};

const selectedVariantClasses: Partial<Record<Variant, string>> = {
  secondary: "border-accent bg-accent-faint text-accent",
  ghost: "bg-accent-faint text-accent",
};

const sizeClasses: Record<Size, string> = {
  xs: "gap-1 px-2 py-1 text-[11px]",
  sm: "gap-1.5 px-2.5 py-1.5 text-xs",
  md: "gap-2 px-4 py-2 text-sm",
};

const baseClasses =
  "inline-flex shrink-0 items-center justify-center rounded-sm font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40";

interface CommonButtonProps {
  variant?: Variant;
  size?: Size;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Visual "active/selected" state — only meaningful for secondary/ghost */
  selected?: boolean;
  fullWidth?: boolean;
}

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    CommonButtonProps {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "secondary",
      size = "sm",
      leading,
      trailing,
      loading,
      selected,
      fullWidth,
      disabled,
      children,
      type,
      ...props
    },
    ref,
  ) => {
    const cls = selected
      ? selectedVariantClasses[variant] ?? variantClasses[variant]
      : variantClasses[variant];

    return (
      <button
        ref={ref}
        type={type ?? "button"}
        disabled={disabled ?? loading}
        className={cn(
          baseClasses,
          cls,
          sizeClasses[size],
          fullWidth && "w-full",
          className,
        )}
        {...props}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          leading
        )}
        {children}
        {trailing}
      </button>
    );
  },
);

Button.displayName = "Button";

/* ── LinkButton ─────────────────────────────────────────────────────── */

interface LinkButtonProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "type">,
    CommonButtonProps {
  href: string;
}

export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(
  (
    {
      className,
      variant = "secondary",
      size = "sm",
      leading,
      trailing,
      selected,
      fullWidth,
      href,
      children,
      ...props
    },
    ref,
  ) => {
    const cls = selected
      ? selectedVariantClasses[variant] ?? variantClasses[variant]
      : variantClasses[variant];
    const external = /^https?:\/\//.test(href);

    const classes = cn(
      baseClasses,
      cls,
      sizeClasses[size],
      fullWidth && "w-full",
      className,
    );

    if (external) {
      return (
        <a
          ref={ref}
          href={href}
          className={classes}
          target={props.target ?? "_blank"}
          rel={props.rel ?? "noopener noreferrer"}
          {...props}
        >
          {leading}
          {children}
          {trailing}
        </a>
      );
    }

    return (
      <Link href={href} className={classes} ref={ref} {...props}>
        {leading}
        {children}
        {trailing}
      </Link>
    );
  },
);

LinkButton.displayName = "LinkButton";

/* ── IconButton ─────────────────────────────────────────────────────── */

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  /** Accessible label. Always required — this is an icon-only button. */
  label: string;
  variant?: Variant;
  size?: Size;
  selected?: boolean;
}

const iconSizeClasses: Record<Size, string> = {
  xs: "h-6 w-6",
  sm: "h-7 w-7",
  md: "h-8 w-8",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      label,
      className,
      variant = "ghost",
      size = "sm",
      selected,
      type,
      ...props
    },
    ref,
  ) => {
    const cls = selected
      ? selectedVariantClasses[variant] ?? variantClasses[variant]
      : variantClasses[variant];

    return (
      <button
        ref={ref}
        type={type ?? "button"}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40",
          cls,
          iconSizeClasses[size],
          className,
        )}
        {...props}
      >
        {icon}
      </button>
    );
  },
);

IconButton.displayName = "IconButton";
