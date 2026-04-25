// Predict the next chapter release for a series by taking the median gap
// between its recent publishedAt timestamps. Pure math — no DB, no IO.
// Callers decide whether to even invoke this (e.g. skip dropped/completed
// entries) and whether the prediction is fresh enough to display.

export interface NextReleasePrediction {
  /** Unix ms of the predicted next release. */
  expectedAt: number;
  /** True when (now - lastPublished) > 1.5 × median gap — series is late. */
  overdue: boolean;
  /** The median gap used, in ms. Exposed for UI/debugging. */
  medianGapMs: number;
}

const HOUR_MS = 60 * 60 * 1000;

// A single same-day catch-up burst can produce 20-minute gaps. Clamp the
// effective gap to 12h so we never render "expected in 13 minutes" nonsense.
const MIN_EFFECTIVE_GAP_MS = 12 * HOUR_MS;

// Cap at ~3 months. Past this, the median is almost certainly poisoned by
// a hiatus or the series has effectively stopped — suppress rather than
// show "expected next July".
const MAX_EFFECTIVE_GAP_MS = 90 * 24 * HOUR_MS;

/**
 * Predict the next release date for a series.
 *
 * Returns null when there isn't enough signal (<4 dated chapters) or when
 * the inferred cadence is too noisy to be useful. We deliberately use the
 * last 6 chapters (up to 5 gaps) rather than the whole history — a series
 * that used to be weekly and is now fortnightly should read as fortnightly.
 */
export function predictNextRelease(
  publishedAts: ReadonlyArray<number | null | undefined>,
  now: number = Date.now(),
): NextReleasePrediction | null {
  const valid = publishedAts
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t) && t > 0)
    .sort((a, b) => a - b);

  // Need ≥4 chapters → ≥3 gaps. Fewer than this and a median is a guess
  // dressed up with false precision.
  if (valid.length < 4) return null;

  const recent = valid.slice(-6);
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    gaps.push(recent[i] - recent[i - 1]);
  }

  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  if (median > MAX_EFFECTIVE_GAP_MS) return null;

  const effectiveGap = Math.max(median, MIN_EFFECTIVE_GAP_MS);
  const lastPublished = recent[recent.length - 1];
  const expectedAt = lastPublished + effectiveGap;
  const overdue = now - lastPublished > 1.5 * effectiveGap;

  return { expectedAt, overdue, medianGapMs: median };
}

/**
 * Dense, calendar-aware label for an upcoming release timestamp.
 * Returns "today" / "tomorrow" when appropriate, "in 3d" within the
 * week, "Apr 24" within the current year, "Apr 24, 2027" otherwise.
 * Returns null for nullish input.
 */
export function formatExpectedDate(
  expectedAt: number | null | undefined,
  now: number = Date.now(),
): string | null {
  if (expectedAt == null || !Number.isFinite(expectedAt)) return null;

  const DAY = 24 * HOUR_MS;
  const expected = new Date(expectedAt);
  const ref = new Date(now);

  const expectedDay = startOfDay(expected);
  const refDay = startOfDay(ref);
  const dayDelta = Math.round((expectedDay - refDay) / DAY);

  if (dayDelta === 0) return "today";
  if (dayDelta === 1) return "tomorrow";
  if (dayDelta > 1 && dayDelta < 7) return `in ${dayDelta}d`;

  const sameYear = expected.getFullYear() === ref.getFullYear();
  return expected.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

