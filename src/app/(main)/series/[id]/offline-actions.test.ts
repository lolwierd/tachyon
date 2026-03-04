import { describe, expect, it } from "vitest";
import {
  getBulkDownloadTargetChapterIds,
  getReadDownloadedChapterIds,
} from "./offline-actions";

const chapters = [
  { sourceChapterId: "c1", readState: "read" as const },
  { sourceChapterId: "c2", readState: "in-progress" as const },
  { sourceChapterId: "c3", readState: "unread" as const },
  { sourceChapterId: "c4", readState: "unread" as const },
];

describe("series offline actions", () => {
  it("excludes already downloaded chapters from bulk downloads", () => {
    expect(
      getBulkDownloadTargetChapterIds(chapters, new Set(["c2", "c4"]), "all"),
    ).toEqual(["c1", "c3"]);
  });

  it("targets only non-read chapters for unread downloads", () => {
    expect(
      getBulkDownloadTargetChapterIds(chapters, new Set(["c4"]), "unread"),
    ).toEqual(["c2", "c3"]);
  });

  it("limits next downloads after filtering out read and downloaded chapters", () => {
    const manyChapters = Array.from({ length: 60 }, (_, index) => ({
      sourceChapterId: `c${index + 1}`,
      readState: index < 5 ? ("read" as const) : ("unread" as const),
    }));

    expect(
      getBulkDownloadTargetChapterIds(manyChapters, new Set(["c6", "c7"]), "next50"),
    ).toHaveLength(50);
    expect(
      getBulkDownloadTargetChapterIds(manyChapters, new Set(["c6", "c7"]), "next50").slice(0, 3),
    ).toEqual(["c8", "c9", "c10"]);
  });

  it("returns only read chapters that are already downloaded", () => {
    expect(
      getReadDownloadedChapterIds(chapters, new Set(["c1", "c3", "c4"])),
    ).toEqual(["c1"]);
  });
});
