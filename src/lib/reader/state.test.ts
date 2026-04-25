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

  it("round-trips scrollOffset alongside currentPage", async () => {
    const id = `series-scroll-offset-${crypto.randomUUID()}`;
    await ensureSeriesRecord(id, undefined, "weebcentral");

    await saveReaderProgress({
      sourceSeriesId: id,
      sourceChapterId: "ch-1",
      chapterTitle: "Chapter 1",
      chapterNo: 1,
      pageCount: 5,
      currentPage: 2,
      scrollOffset: 0.73,
    });

    const state = getReaderState(id, "ch-1");
    expect(state.progress.currentPage).toBe(2);
    expect(state.progress.scrollOffset).toBeCloseTo(0.73, 5);
  });

  it("clamps out-of-range scrollOffset values to [0, 1]", async () => {
    const id = `series-scroll-clamp-${crypto.randomUUID()}`;
    await ensureSeriesRecord(id, undefined, "weebcentral");

    await saveReaderProgress({
      sourceSeriesId: id,
      sourceChapterId: "ch-1",
      chapterTitle: "Chapter 1",
      chapterNo: 1,
      pageCount: 5,
      currentPage: 0,
      scrollOffset: -0.5,
    });
    expect(getReaderState(id, "ch-1").progress.scrollOffset).toBe(0);

    await saveReaderProgress({
      sourceSeriesId: id,
      sourceChapterId: "ch-1",
      chapterTitle: "Chapter 1",
      chapterNo: 1,
      pageCount: 5,
      currentPage: 0,
      scrollOffset: 42,
    });
    expect(getReaderState(id, "ch-1").progress.scrollOffset).toBe(1);
  });

  it("defaults scrollOffset to 0 when omitted", async () => {
    const id = `series-scroll-default-${crypto.randomUUID()}`;
    await ensureSeriesRecord(id, undefined, "weebcentral");

    await saveReaderProgress({
      sourceSeriesId: id,
      sourceChapterId: "ch-1",
      chapterTitle: "Chapter 1",
      chapterNo: 1,
      pageCount: 5,
      currentPage: 3,
    });

    expect(getReaderState(id, "ch-1").progress.scrollOffset).toBe(0);
  });

  it("ignores stale progress updates that arrive after a newer save", async () => {
    const id = `series-stale-progress-${crypto.randomUUID()}`;
    await ensureSeriesRecord(id, undefined, "weebcentral");

    await saveReaderProgress({
      sourceSeriesId: id,
      sourceChapterId: "ch-1",
      chapterTitle: "Chapter 1",
      chapterNo: 1,
      pageCount: 10,
      currentPage: 6,
      updatedAt: "2026-03-05T00:00:05.000Z",
    });

    await saveReaderProgress({
      sourceSeriesId: id,
      sourceChapterId: "ch-1",
      chapterTitle: "Chapter 1",
      chapterNo: 1,
      pageCount: 10,
      currentPage: 2,
      updatedAt: "2026-03-05T00:00:01.000Z",
    });

    const state = getReaderState(id, "ch-1");
    expect(state.progress.currentPage).toBe(6);
    expect(state.progress.completed).toBe(false);
  });
});
