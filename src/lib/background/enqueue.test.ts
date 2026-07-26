import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { useTestDb } from "@/lib/db/test-utils";
import {
  backgroundRun,
  backgroundTask,
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

function insertMappedSeries(
  sourceSeriesId: string,
  source:
    | "weebcentral"
    | "omegascans"
    | "madaradex"
    | "toonily"
    | "oppai"
    | "manhwa18"
    | "hentai20" = "weebcentral",
) {
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
    insertChapterRow({
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
      chapterId: ch1,
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
          chapterIds: ["ch-3"],
        }),
        tasks: [
          expect.objectContaining({
            taskType: "download_chapter",
            sourceChapterId: "ch-3",
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

describe("enqueueRefreshAllManifests", () => {
  useTestDb();

  beforeEach(() => {
    createRunWithTasksMock.mockReset();
    createRunWithTasksMock.mockImplementation((input: unknown) => input);
  });

  it("only queues ready chapters for the source mapping that owns them", async () => {
    const localSeriesId = id("series-shared");

    getDb().insert(series).values({
      id: localSeriesId,
      title: "Shared Series",
      adult: false,
    }).run();

    getDb().insert(sourceMapping).values([
      {
        id: id("mapping"),
        seriesId: localSeriesId,
        source: "oppai",
        sourceSeriesId: "oppai-series",
        sourceUrl: "https://example.test/oppai-series",
      },
      {
        id: id("mapping"),
        seriesId: localSeriesId,
        source: "toonily",
        sourceSeriesId: "toonily-series",
        sourceUrl: "https://example.test/toonily-series",
      },
    ]).run();

    const oppaiChapterId = insertChapterRow({
      seriesId: localSeriesId,
      source: "oppai",
      sourceChapterId: "chapter-1",
      chapterNo: 1,
    });
    const toonilyChapterId = insertChapterRow({
      seriesId: localSeriesId,
      source: "toonily",
      sourceChapterId: "chapter-1",
      chapterNo: 1,
    });

    getDb().insert(mediaCache).values([
      {
        chapterId: oppaiChapterId,
        state: "ready",
        path: "/tmp/oppai-ch-1",
      },
      {
        chapterId: toonilyChapterId,
        state: "ready",
        path: "/tmp/toonily-ch-1",
      },
    ]).run();

    const { enqueueRefreshAllManifests } = await import("./enqueue");
    const queued = enqueueRefreshAllManifests();

    expect(queued).toBe(2);
    expect(createRunWithTasksMock).toHaveBeenCalledTimes(2);
    expect(createRunWithTasksMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        scope: expect.objectContaining({
          sourceSeriesId: "oppai-series",
          chapterIds: ["chapter-1"],
        }),
        tasks: [
          expect.objectContaining({
            sourceSeriesId: "oppai-series",
            sourceChapterId: "chapter-1",
          }),
        ],
      }),
    );
    expect(createRunWithTasksMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        scope: expect.objectContaining({
          sourceSeriesId: "toonily-series",
          chapterIds: ["chapter-1"],
        }),
        tasks: [
          expect.objectContaining({
            sourceSeriesId: "toonily-series",
            sourceChapterId: "chapter-1",
          }),
        ],
      }),
    );
  });

  it("skips chapters that already have an active manifest refresh task", async () => {
    const mapped = insertMappedSeries("oppai-series", "oppai");
    const chapterRow = insertChapterRow({
      seriesId: mapped.seriesId,
      source: mapped.source,
      sourceChapterId: "chapter-1",
      chapterNo: 1,
    });

    getDb().insert(mediaCache).values({
      chapterId: chapterRow,
      state: "ready",
      path: "/tmp/oppai-ch-1",
    }).run();

    const runId = id("run");
    getDb().insert(backgroundRun).values({
      id: runId,
      kind: "download",
      trigger: "manual",
      status: "queued",
      scopeJson: "{}",
      totalTasks: 1,
      doneTasks: 0,
      failedTasks: 0,
      canceledTasks: 0,
    }).run();

    getDb().insert(backgroundTask).values({
      id: id("task"),
      runId,
      queue: "download",
      taskType: "download_chapter",
      sourceSeriesId: "oppai-series",
      sourceChapterId: "chapter-1",
      payloadJson: "{}",
      state: "queued",
      dedupeKey: "download:oppai-series:chapter-1",
    }).run();

    const { enqueueRefreshAllManifests } = await import("./enqueue");
    const queued = enqueueRefreshAllManifests();

    expect(queued).toBe(0);
    expect(createRunWithTasksMock).not.toHaveBeenCalled();
  });
});

describe("enqueueUpdateRun", () => {
  beforeEach(() => {
    createRunWithTasksMock.mockReset();
    createRunWithTasksMock.mockImplementation((input: unknown) => input);
  });

  it("does not retry a whole refresh after the source adapter exhausts its retries", async () => {
    const { enqueueUpdateRun } = await import("./enqueue");

    enqueueUpdateRun({
      entries: [
        { source: "omegascans", sourceSeriesId: "series-a" },
        { source: "omegascans", sourceSeriesId: "series-a" },
      ],
      trigger: "manual",
      reason: "test",
    });

    expect(createRunWithTasksMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [
          expect.objectContaining({
            sourceSeriesId: "series-a",
            maxAttempts: 1,
          }),
        ],
      }),
    );
  });
});
