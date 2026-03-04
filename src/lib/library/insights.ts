import type { LibraryEntryRecord } from "@/lib/library/state";

export interface LibraryInsights {
  unreadChapters: LibraryEntryRecord[];
  stalledSeries: LibraryEntryRecord[];
  recentlyCompleted: LibraryEntryRecord[];
}

const STALLED_DAYS = 14;
const RECENTLY_COMPLETED_DAYS = 30;

function daysAgo(date: Date, days: number) {
  return date.getTime() - days * 24 * 60 * 60 * 1000;
}

export function deriveLibraryInsights(
  entries: LibraryEntryRecord[],
  now = new Date(),
): LibraryInsights {
  const stalledCutoff = daysAgo(now, STALLED_DAYS);
  const completedCutoff = daysAgo(now, RECENTLY_COMPLETED_DAYS);

  const unreadChapters = entries
    .filter((entry) => entry.unreadChapters > 0 && entry.status !== "completed" && entry.status !== "dropped")
    .sort((left, right) => right.unreadChapters - left.unreadChapters || left.title.localeCompare(right.title))
    .slice(0, 6);

  const stalledSeries = entries
    .filter(
      (entry) =>
        (entry.status === "reading" || entry.status === "rereading") &&
        entry.unreadChapters > 0 &&
        entry.progressUpdatedAt &&
        new Date(entry.progressUpdatedAt).getTime() <= stalledCutoff,
    )
    .sort((left, right) => {
      const leftTime = left.progressUpdatedAt ? new Date(left.progressUpdatedAt).getTime() : 0;
      const rightTime = right.progressUpdatedAt ? new Date(right.progressUpdatedAt).getTime() : 0;
      return leftTime - rightTime;
    })
    .slice(0, 6);

  const recentlyCompleted = entries
    .filter(
      (entry) =>
        entry.lastCompletedAt &&
        new Date(entry.lastCompletedAt).getTime() >= completedCutoff,
    )
    .sort((left, right) => {
      const leftTime = left.lastCompletedAt ? new Date(left.lastCompletedAt).getTime() : 0;
      const rightTime = right.lastCompletedAt ? new Date(right.lastCompletedAt).getTime() : 0;
      return rightTime - leftTime;
    })
    .slice(0, 6);

  return {
    unreadChapters,
    stalledSeries,
    recentlyCompleted,
  };
}
