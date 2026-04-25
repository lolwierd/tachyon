import { describe, expect, it } from "vitest";
import { parseDateLoose, parseRelativeDate } from "./relative-date";

const NOW = new Date("2026-04-20T12:00:00Z").getTime();
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

describe("parseRelativeDate", () => {
  it("parses seconds/minutes/hours/days/weeks/months/years", () => {
    expect(parseRelativeDate("3 seconds ago", NOW)).toBe(NOW - 3 * SECOND);
    expect(parseRelativeDate("5 minutes ago", NOW)).toBe(NOW - 5 * MINUTE);
    expect(parseRelativeDate("2 hours ago", NOW)).toBe(NOW - 2 * HOUR);
    expect(parseRelativeDate("1 day ago", NOW)).toBe(NOW - DAY);
    expect(parseRelativeDate("3 weeks ago", NOW)).toBe(NOW - 3 * WEEK);
    expect(parseRelativeDate("2 months ago", NOW)).toBe(NOW - 2 * 30 * DAY);
    expect(parseRelativeDate("1 year ago", NOW)).toBe(NOW - 365 * DAY);
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(parseRelativeDate("  2 DAYS AGO  ", NOW)).toBe(NOW - 2 * DAY);
    expect(parseRelativeDate("2  Days  Ago", NOW)).toBe(NOW - 2 * DAY);
  });

  it("handles 'a'/'an' singular forms", () => {
    expect(parseRelativeDate("an hour ago", NOW)).toBe(NOW - HOUR);
    expect(parseRelativeDate("a day ago", NOW)).toBe(NOW - DAY);
  });

  it("handles 'yesterday' / 'today' / 'just now'", () => {
    expect(parseRelativeDate("yesterday", NOW)).toBe(NOW - DAY);
    expect(parseRelativeDate("today", NOW)).toBe(NOW);
    expect(parseRelativeDate("just now", NOW)).toBe(NOW);
    expect(parseRelativeDate("a moment ago", NOW)).toBe(NOW);
  });

  it("returns null for non-matching input", () => {
    expect(parseRelativeDate("Mar 5, 2024", NOW)).toBe(null);
    expect(parseRelativeDate("", NOW)).toBe(null);
    expect(parseRelativeDate(null, NOW)).toBe(null);
    expect(parseRelativeDate(undefined, NOW)).toBe(null);
    expect(parseRelativeDate("some garbage", NOW)).toBe(null);
  });
});

describe("parseDateLoose", () => {
  it("parses ISO strings", () => {
    expect(parseDateLoose("2024-03-05T14:22:09Z", NOW)).toBe(
      Date.parse("2024-03-05T14:22:09Z"),
    );
  });

  it("parses 'MMM d, yyyy' style from Madara", () => {
    expect(parseDateLoose("Mar 5, 2024", NOW)).toBe(Date.parse("Mar 5, 2024"));
  });

  it("falls back to relative parsing", () => {
    expect(parseDateLoose("2 days ago", NOW)).toBe(NOW - 2 * DAY);
    expect(parseDateLoose("yesterday", NOW)).toBe(NOW - DAY);
  });

  it("returns null for unparseable input", () => {
    expect(parseDateLoose("nonsense", NOW)).toBe(null);
    expect(parseDateLoose(null, NOW)).toBe(null);
  });
});
