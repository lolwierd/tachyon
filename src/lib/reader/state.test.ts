import { describe, expect, it, vi } from "vitest";
import { ensureSeriesRecord } from "@/lib/library/shared";
import { getReaderState, saveReaderProgress } from "./state";

vi.mock("@/lib/sources/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sources/registry")>();
  return {
    ...actual,
    getSource: vi.fn(() => ({
      search: vi.fn(async () => []),
      getSeriesDetail: vi.fn(async (sourceId: string) => ({
        sourceId,
        title: `Series ${sourceId}`,
        slug: sourceId,
        coverUrl: "https://img.example/cover.jpg",
        description: "test",
        authors: [],
        tags: [],
        type: "Manga",
        status: "Ongoing",
        year: 2024,
        isAdult: false,
        isOfficial: false,
        anilistUrl: null,
        relatedSeries: [],
      })),
      getChapterList: vi.fn(async () => []),
      getChapterPages: vi.fn(async () => []),
    })),
  };
});

describe("saveReaderProgress completion semantics", () => {
  it("does not complete a chapter before the last page even if completed=true is supplied", async () => {
    const id = `series-complete-strict-${crypto.randomUUID()}`;
    await ensureSeriesRecord(id, undefined, "weebcentral");

    await saveReaderProgress({
      sourceSeriesId: id,
      sourceChapterId: "ch-1",
      chapterTitle: "Chapter 1",
      chapterNo: 1,
      pageCount: 5,
      currentPage: 2,
      completed: true,
    });

    const state = getReaderState(id, "ch-1");
    expect(state.progress.completed).toBe(false);
    expect(state.progress.currentPage).toBe(2);
  });

  it("keeps completed=true once the final page has been reached", async () => {
    const id = `series-complete-sticky-${crypto.randomUUID()}`;
    await ensureSeriesRecord(id, undefined, "weebcentral");

    await saveReaderProgress({
      sourceSeriesId: id,
      sourceChapterId: "ch-1",
      chapterTitle: "Chapter 1",
      chapterNo: 1,
      pageCount: 5,
      currentPage: 4,
    });

    await saveReaderProgress({
      sourceSeriesId: id,
      sourceChapterId: "ch-1",
      chapterTitle: "Chapter 1",
      chapterNo: 1,
      pageCount: 5,
      currentPage: 1,
    });

    const state = getReaderState(id, "ch-1");
    expect(state.progress.completed).toBe(true);
    expect(state.progress.currentPage).toBe(1);
  });
});
