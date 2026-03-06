import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { useTestDb } from "@/lib/db/test-utils";
import {
  chapter,
  chapterProgress,
  mediaCache,
  series,
  sourceMapping,
} from "@/lib/db/schema";

const createRunWithTasksMock = vi.fn();
const getBackgroundSettingsMock = vi.fn();

vi.mock("@/lib/background/queue", () => ({
  createRunWithTasks: createRunWithTasksMock,
}));

vi.mock("@/lib/background/settings", () => ({
  getBackgroundSettings: getBackgroundSettingsMock,
}));

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function insertMappedSeries(sourceSeriesId: string, source: "weebcentral" | "comix" | "omegascans" | "madaradex" = "comix") {
  const seriesId = id("series");
  getDb().insert(series).values({
    id: seriesId,
    title: sourceSeriesId,
    adult: false,
  }).run();
  getDb().insert(sourceMapping).values({
    id: id("mapping"),
    seriesId,
    source,
    sourceSeriesId,
    sourceUrl: `https://example.test/${sourceSeriesId}`,
  }).run();
  return { seriesId, sourceSeriesId, source };
}

function insertChapterRow(input: {
  seriesId: string;
  source: string;
  sourceChapterId: string;
  chapterNo: number;
  sortKey?: number;
}) {
  const chapterId = id("chapter");
  getDb().insert(chapter).values({
    id: chapterId,
    seriesId: input.seriesId,
    source: input.source,
    sourceChapterId: input.sourceChapterId,
    chapterNo: input.chapterNo,
    sortKey: input.sortKey ?? input.chapterNo,
    title: `Chapter ${input.chapterNo}`,
  }).run();
  return chapterId;
}

describe("enqueueAfterChapterCompleted", () => {
  useTestDb();

  beforeEach(() => {
    createRunWithTasksMock.mockReset();
    createRunWithTasksMock.mockImplementation((input: unknown) => input);
    getBackgroundSettingsMock.mockReset();
    getBackgroundSettingsMock.mockReturnValue({
      nextNAfterRead: 2,
      autoDeleteReadEnabled: true,
      autoDeleteKeepLastN: 3,
    });
  });

  it("only auto-downloads next chapters when the completed chapter is already downloaded", async () => {
    const mapped = insertMappedSeries(id("series-current-not-downloaded"));
    insertChapterRow({
      seriesId: mapped.seriesId,
      source: mapped.source,
      sourceChapterId: "ch-1",
      chapterNo: 1,
    });
    insertChapterRow({
      seriesId: mapped.seriesId,
      source: mapped.source,
      sourceChapterId: "ch-2",
      chapterNo: 2,
    });

    const { enqueueAfterChapterCompleted } = await import("./enqueue");
    enqueueAfterChapterCompleted(mapped.sourceSeriesId, "ch-1");

    expect(createRunWithTasksMock).not.toHaveBeenCalled();
  });

  it("queues next unread undownloaded chapters after finishing a downloaded chapter", async () => {
    const mapped = insertMappedSeries(id("series-current-downloaded"));
    const ch1 = insertChapterRow({
      seriesId: mapped.seriesId,
      source: mapped.source,
      sourceChapterId: "ch-1",
      chapterNo: 1,
    });
    const ch2 = insertChapterRow({
      seriesId: mapped.seriesId,
      source: mapped.source,
      sourceChapterId: "ch-2",
      chapterNo: 2,
    });
    const ch3 = insertChapterRow({
      seriesId: mapped.seriesId,
      source: mapped.source,
      sourceChapterId: "ch-3",
      chapterNo: 3,
    });
    insertChapterRow({
      seriesId: mapped.seriesId,
      source: mapped.source,
      sourceChapterId: "ch-4",
      chapterNo: 4,
    });

    getDb().insert(mediaCache).values({
      chapterId: ch1,
      state: "ready",
      path: "/tmp/ch-1",
    }).run();
    getDb().insert(mediaCache).values({
      chapterId: ch2,
      state: "ready",
      path: "/tmp/ch-2",
    }).run();
    getDb().insert(chapterProgress).values({
      chapterId: ch3,
      seriesId: mapped.seriesId,
      completed: true,
    }).run();

    const { enqueueAfterChapterCompleted } = await import("./enqueue");
    enqueueAfterChapterCompleted(mapped.sourceSeriesId, "ch-1");

    expect(createRunWithTasksMock).toHaveBeenCalledTimes(2);
    expect(createRunWithTasksMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        scope: expect.objectContaining({
          reason: "after_chapter_completed",
          sourceSeriesId: mapped.sourceSeriesId,
          chapterIds: ["ch-4"],
        }),
        tasks: [
          expect.objectContaining({
            taskType: "download_chapter",
            sourceChapterId: "ch-4",
          }),
        ],
      }),
    );
    expect(createRunWithTasksMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        tasks: [
          expect.objectContaining({
            taskType: "delete_read_downloads",
          }),
        ],
      }),
    );
  });
});
