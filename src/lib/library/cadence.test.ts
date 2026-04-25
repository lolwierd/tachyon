import { describe, expect, it } from "vitest";
import { formatExpectedDate, predictNextRelease } from "./cadence";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-04-20T12:00:00Z");

function daysAgo(days: number): number {
  return NOW - days * DAY;
}

describe("predictNextRelease", () => {
  it("predicts the next drop for a steady weekly cadence", () => {
    const publishedAts = [
      daysAgo(28),
      daysAgo(21),
      daysAgo(14),
      daysAgo(7),
    ];
    const result = predictNextRelease(publishedAts, NOW);
    expect(result).not.toBeNull();
    expect(result!.expectedAt).toBe(NOW);
    expect(result!.overdue).toBe(false);
    expect(result!.medianGapMs).toBe(7 * DAY);
  });

  it("flags overdue when last drop exceeds 1.5× the median gap", () => {
    const publishedAts = [
      daysAgo(40),
      daysAgo(33),
      daysAgo(26),
      daysAgo(19),
      daysAgo(12), // should have had another by day 5, it's been 12
    ];
    const result = predictNextRelease(publishedAts, NOW);
    expect(result).not.toBeNull();
    expect(result!.overdue).toBe(true);
  });

  it("uses median to shrug off a single long gap (scanlator vacation)", () => {
    const publishedAts = [
      daysAgo(60), // long gap follows
      daysAgo(30), // ← 30d gap (outlier)
      daysAgo(23),
      daysAgo(16),
      daysAgo(9),
      daysAgo(2),
    ];
    const result = predictNextRelease(publishedAts, NOW);
    expect(result).not.toBeNull();
    // Five gaps: 30, 7, 7, 7, 7 → median = 7
    expect(result!.medianGapMs).toBe(7 * DAY);
  });

  it("returns null for fewer than 4 dated chapters", () => {
    expect(predictNextRelease([daysAgo(1)], NOW)).toBeNull();
    expect(predictNextRelease([daysAgo(14), daysAgo(7), daysAgo(1)], NOW)).toBeNull();
  });

  it("ignores null/undefined/zero timestamps without crashing", () => {
    const publishedAts = [
      null,
      undefined,
      0,
      daysAgo(28),
      daysAgo(21),
      daysAgo(14),
      daysAgo(7),
    ];
    const result = predictNextRelease(publishedAts, NOW);
    expect(result).not.toBeNull();
    expect(result!.medianGapMs).toBe(7 * DAY);
  });

  it("sorts out-of-order inputs before computing gaps", () => {
    const publishedAts = [
      daysAgo(7),
      daysAgo(28),
      daysAgo(14),
      daysAgo(21),
    ];
    const result = predictNextRelease(publishedAts, NOW);
    expect(result).not.toBeNull();
    expect(result!.medianGapMs).toBe(7 * DAY);
  });

  it("returns null when the cadence exceeds ~3 months (likely hiatus or dead)", () => {
    const publishedAts = [
      daysAgo(500),
      daysAgo(400),
      daysAgo(300),
      daysAgo(200),
    ];
    expect(predictNextRelease(publishedAts, NOW)).toBeNull();
  });

  it("returns null when no valid timestamps remain after filtering", () => {
    expect(predictNextRelease([null, undefined, 0, -5], NOW)).toBeNull();
    expect(predictNextRelease([], NOW)).toBeNull();
  });

  it("clamps sub-12h cadences to avoid false-precision predictions", () => {
    // Catch-up burst: 4 chapters in 3 hours then nothing.
    const publishedAts = [
      NOW - 3 * HOUR,
      NOW - 2 * HOUR,
      NOW - 1 * HOUR,
      NOW,
    ];
    const result = predictNextRelease(publishedAts, NOW);
    expect(result).not.toBeNull();
    expect(result!.medianGapMs).toBe(HOUR);
    // Clamped floor: predicted next is ≥12h out, not 1h out.
    expect(result!.expectedAt - NOW).toBe(12 * HOUR);
  });
});

describe("formatExpectedDate", () => {
  it("returns 'today' when the expected timestamp falls on today", () => {
    expect(formatExpectedDate(NOW + 2 * HOUR, NOW)).toBe("today");
    expect(formatExpectedDate(NOW - 1 * HOUR, NOW)).toBe("today");
  });

  it("returns 'tomorrow' when expected is the next calendar day", () => {
    expect(formatExpectedDate(NOW + 1 * DAY, NOW)).toBe("tomorrow");
  });

  it("returns 'in Nd' within the next week", () => {
    expect(formatExpectedDate(NOW + 3 * DAY, NOW)).toBe("in 3d");
    expect(formatExpectedDate(NOW + 6 * DAY, NOW)).toBe("in 6d");
  });

  it("returns a month-day label for dates beyond a week", () => {
    const label = formatExpectedDate(NOW + 10 * DAY, NOW);
    expect(label).toMatch(/^[A-Za-z]+ \d+$/);
  });

  it("includes year when the expected date falls in a different year", () => {
    const nextYear = Date.parse("2027-03-01T12:00:00Z");
    const label = formatExpectedDate(nextYear, NOW);
    expect(label).toContain("2027");
  });

  it("returns null for nullish input", () => {
    expect(formatExpectedDate(null, NOW)).toBeNull();
    expect(formatExpectedDate(undefined, NOW)).toBeNull();
    expect(formatExpectedDate(NaN, NOW)).toBeNull();
  });
});
