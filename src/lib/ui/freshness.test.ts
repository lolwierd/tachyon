import { describe, expect, it } from "vitest";
import {
  formatAbsolute,
  formatRelative,
  formatUpdatedPhrase,
  lampFromAgeMs,
  lampFromPublishedAt,
} from "./freshness";

const NOW = Date.parse("2026-04-20T12:00:00Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

describe("lampFromAgeMs", () => {
  it("buckets by age", () => {
    expect(lampFromAgeMs(3 * HOUR)).toBe("fresh");
    expect(lampFromAgeMs(2 * DAY)).toBe("warm");
    expect(lampFromAgeMs(5 * DAY)).toBe("fading");
    expect(lampFromAgeMs(2 * WEEK)).toBe("cool");
    expect(lampFromAgeMs(6 * WEEK)).toBe(null);
  });

  it("returns null for invalid input", () => {
    expect(lampFromAgeMs(null)).toBe(null);
    expect(lampFromAgeMs(undefined)).toBe(null);
    expect(lampFromAgeMs(-1)).toBe(null);
    expect(lampFromAgeMs(NaN)).toBe(null);
  });
});

describe("lampFromPublishedAt", () => {
  it("is equivalent to lampFromAgeMs(now - ts)", () => {
    expect(lampFromPublishedAt(NOW - 3 * HOUR, NOW)).toBe("fresh");
    expect(lampFromPublishedAt(NOW - 6 * WEEK, NOW)).toBe(null);
    expect(lampFromPublishedAt(null, NOW)).toBe(null);
  });
});

describe("formatRelative", () => {
  it("returns a dense short-form phrase", () => {
    expect(formatRelative(NOW - 30 * SECOND, NOW)).toBe("just now");
    expect(formatRelative(NOW - 5 * MINUTE, NOW)).toBe("5m ago");
    expect(formatRelative(NOW - 3 * HOUR, NOW)).toBe("3h ago");
    expect(formatRelative(NOW - 2 * DAY, NOW)).toBe("2d ago");
    expect(formatRelative(NOW - 3 * WEEK, NOW)).toBe("3w ago");
  });

  it("returns null when no date", () => {
    expect(formatRelative(null, NOW)).toBe(null);
    expect(formatRelative(undefined, NOW)).toBe(null);
  });

  it("handles clock skew gracefully", () => {
    expect(formatRelative(NOW + 60 * SECOND, NOW)).toBe("just now");
  });
});

describe("formatUpdatedPhrase", () => {
  it("is the longer header-style phrase", () => {
    expect(formatUpdatedPhrase(NOW - 3 * HOUR, NOW)).toBe("Updated 3 hours ago");
    expect(formatUpdatedPhrase(NOW - HOUR, NOW)).toBe("Updated 1 hour ago");
    expect(formatUpdatedPhrase(NOW - 2 * DAY, NOW)).toBe("Updated 2 days ago");
    expect(formatUpdatedPhrase(NOW - DAY - HOUR, NOW)).toBe("Updated yesterday");
    expect(formatUpdatedPhrase(NOW - 4 * WEEK, NOW)).toBe("Updated 4 weeks ago");
  });

  it("returns null when no date", () => {
    expect(formatUpdatedPhrase(null, NOW)).toBe(null);
  });
});

describe("formatAbsolute", () => {
  it("returns a human-readable date+time for tooltips", () => {
    const s = formatAbsolute(NOW);
    expect(s).toBeTruthy();
    // exact format is locale-dependent; just check it contains date hints
    expect(typeof s).toBe("string");
    expect(s!.length).toBeGreaterThan(5);
  });

  it("returns null when no date", () => {
    expect(formatAbsolute(null)).toBe(null);
  });
});
