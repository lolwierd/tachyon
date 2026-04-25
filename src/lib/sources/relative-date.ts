// Parse English relative-date strings as emitted by several of our sources
// (madara themes, oppai, hentai20, toonily). Returns unix ms, or null when
// the input doesn't match a known shape.
//
// We intentionally keep this narrow: just the patterns we actually see in
// the wild. Mihon carries a much larger i18n vocabulary, but our sources
// serve English and it's not worth maintaining a 12-locale token list for
// dates we ultimately just bucket into "fresh / warm / fading / cool".

const UNIT_SECONDS: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 60 * 60,
  day: 24 * 60 * 60,
  week: 7 * 24 * 60 * 60,
  // Approximate — we don't know the calendar month, and consumers are using
  // this to drive freshness buckets, not to recover an exact timestamp.
  month: 30 * 24 * 60 * 60,
  year: 365 * 24 * 60 * 60,
};

const RELATIVE_RE = /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i;

export function parseRelativeDate(
  input: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!input) return null;
  const text = input.trim().toLowerCase();
  if (!text) return null;

  if (text === "just now" || text === "moments ago" || text === "a moment ago") {
    return now;
  }
  if (text === "yesterday") {
    return now - UNIT_SECONDS.day * 1000;
  }
  if (text === "today") {
    return now;
  }

  const m = text.match(RELATIVE_RE);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2];
    const seconds = UNIT_SECONDS[unit];
    if (!Number.isFinite(n) || !seconds) return null;
    return now - n * seconds * 1000;
  }

  // "an hour ago", "a day ago" — treat as 1 unit
  const singular = text.match(/^an?\s+(second|minute|hour|day|week|month|year)\s+ago$/);
  if (singular) {
    const seconds = UNIT_SECONDS[singular[1]];
    if (!seconds) return null;
    return now - seconds * 1000;
  }

  return null;
}

// Try an absolute-date parse first (ISO, "Mar 5, 2024", etc.), falling back
// to the relative parser. Useful for sites like Madara that mix both shapes
// in the same chapter list.
export function parseDateLoose(
  input: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!input) return null;
  const text = input.trim();
  if (!text) return null;

  const absolute = Date.parse(text);
  if (Number.isFinite(absolute)) return absolute;

  return parseRelativeDate(text, now);
}
