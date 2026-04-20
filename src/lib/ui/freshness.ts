// Freshness buckets and relative-time formatting for chapter publish dates.
// Centralised so chapter rows, series headers, and library cards all agree
// on what "fresh" means and how a date reads in dense lists.

export type Lamp = "fresh" | "warm" | "fading" | "cool" | null;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Temperature stage of a chapter given its age in ms.
 * Returns null for ages > 4 weeks — past that, absence of a bar IS the signal.
 */
export function lampFromAgeMs(ageMs: number | null | undefined): Lamp {
  if (ageMs == null || !Number.isFinite(ageMs) || ageMs < 0) return null;
  if (ageMs < DAY) return "fresh";
  if (ageMs < 3 * DAY) return "warm";
  if (ageMs < WEEK) return "fading";
  if (ageMs < 4 * WEEK) return "cool";
  return null;
}

/** Same as above but takes the publishedAt timestamp directly. */
export function lampFromPublishedAt(
  publishedAt: number | null | undefined,
  now: number = Date.now(),
): Lamp {
  if (publishedAt == null) return null;
  return lampFromAgeMs(now - publishedAt);
}

/**
 * Short, dense relative time suitable for a chapter list row:
 * "just now", "5m ago", "3h ago", "2d ago", "3w ago", "4mo ago", "2y ago".
 *
 * Returns null when publishedAt is null/undefined — callers should render
 * nothing rather than a placeholder.
 */
export function formatRelative(
  publishedAt: number | null | undefined,
  now: number = Date.now(),
): string | null {
  if (publishedAt == null || !Number.isFinite(publishedAt)) return null;
  const diff = now - publishedAt;
  if (diff < 0) return "just now"; // clock skew — treat future-dated as now
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d ago`;
  if (diff < MONTH) return `${Math.floor(diff / WEEK)}w ago`;
  if (diff < YEAR) return `${Math.floor(diff / MONTH)}mo ago`;
  return `${Math.floor(diff / YEAR)}y ago`;
}

/**
 * Longer relative phrase for the series detail header: "Updated 3 hours ago".
 * Distinct from `formatRelative` because the header has room to breathe and
 * "3h ago" reads too terse there.
 */
export function formatUpdatedPhrase(
  publishedAt: number | null | undefined,
  now: number = Date.now(),
): string | null {
  if (publishedAt == null || !Number.isFinite(publishedAt)) return null;
  const diff = now - publishedAt;
  if (diff < 0) return "Updated just now";
  if (diff < MINUTE) return "Updated just now";
  if (diff < 2 * MINUTE) return "Updated 1 minute ago";
  if (diff < HOUR) return `Updated ${Math.floor(diff / MINUTE)} minutes ago`;
  if (diff < 2 * HOUR) return "Updated 1 hour ago";
  if (diff < DAY) return `Updated ${Math.floor(diff / HOUR)} hours ago`;
  if (diff < 2 * DAY) return "Updated yesterday";
  if (diff < WEEK) return `Updated ${Math.floor(diff / DAY)} days ago`;
  if (diff < 2 * WEEK) return "Updated 1 week ago";
  if (diff < MONTH) return `Updated ${Math.floor(diff / WEEK)} weeks ago`;
  if (diff < 2 * MONTH) return "Updated 1 month ago";
  if (diff < YEAR) return `Updated ${Math.floor(diff / MONTH)} months ago`;
  if (diff < 2 * YEAR) return "Updated 1 year ago";
  return `Updated ${Math.floor(diff / YEAR)} years ago`;
}

/** Absolute date for hover/tooltip: "Apr 18, 2026 · 14:22". */
export function formatAbsolute(publishedAt: number | null | undefined): string | null {
  if (publishedAt == null || !Number.isFinite(publishedAt)) return null;
  const d = new Date(publishedAt);
  const datePart = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} · ${timePart}`;
}

/** CSS variable corresponding to each lamp stage — used for inline style on the edge bar. */
export const LAMP_CSS_VAR: Record<Exclude<Lamp, null>, string> = {
  fresh: "var(--color-lamp-fresh)",
  warm: "var(--color-lamp-warm)",
  fading: "var(--color-lamp-fading)",
  cool: "var(--color-lamp-cool)",
};

/** Tailwind text class for the matching stage, when you want colored date text. */
export const LAMP_TEXT_CLASS: Record<Exclude<Lamp, null>, string> = {
  fresh: "text-[var(--color-lamp-fresh)]",
  warm: "text-[var(--color-lamp-warm)]",
  fading: "text-[var(--color-lamp-fading)]",
  cool: "text-[var(--color-lamp-cool)]",
};
