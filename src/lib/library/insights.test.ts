import { describe, expect, it } from "vitest";
import { deriveLibraryInsights } from "./insights";
import type { LibraryEntryRecord } from "./state";

function entry(overrides: Partial<LibraryEntryRecord>): LibraryEntryRecord {
  return {
    sourceSeriesId: "series-1",
    title: "Series One",
    coverUrl: null,
    status: "reading",
    addedAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    currentPage: 1,
    progressUpdatedAt: "2026-03-01T00:00:00.000Z",
    currentChapterSourceId: "ch-1",
    currentChapterTitle: "Chapter 1",
    totalChapters: 10,
    completedChapters: 2,
    unreadChapters: 8,
    downloadedChapters: 0,
    lastCompletedAt: null,
    lastCompletedChapterSourceId: null,
    lastCompletedChapterTitle: null,
    tagIds: [],
    ...overrides,
  };
}

describe("deriveLibraryInsights", () => {
  it("surfaces unread, stalled, and recently completed sections", () => {
    const now = new Date("2026-03-04T00:00:00.000Z");
    const insights = deriveLibraryInsights([
      entry({
        sourceSeriesId: "unread-series",
        title: "Unread",
        unreadChapters: 12,
        completedChapters: 1,
      }),
      entry({
        sourceSeriesId: "stalled-series",
        title: "Stalled",
        unreadChapters: 4,
        progressUpdatedAt: "2026-02-01T00:00:00.000Z",
      }),
      entry({
        sourceSeriesId: "completed-series",
        title: "Completed",
        status: "completed",
        unreadChapters: 0,
        lastCompletedAt: "2026-03-03T00:00:00.000Z",
        lastCompletedChapterSourceId: "ch-10",
        lastCompletedChapterTitle: "Chapter 10",
      }),
      entry({
        sourceSeriesId: "dropped-series",
        title: "Dropped",
        status: "dropped",
        unreadChapters: 7,
      }),
    ], now);

    expect(insights.unreadChapters.map((item) => item.sourceSeriesId)).toEqual([
      "unread-series",
      "stalled-series",
    ]);
    expect(insights.stalledSeries.map((item) => item.sourceSeriesId)).toEqual([
      "stalled-series",
    ]);
    expect(insights.recentlyCompleted.map((item) => item.sourceSeriesId)).toEqual([
      "completed-series",
    ]);
  });
});
