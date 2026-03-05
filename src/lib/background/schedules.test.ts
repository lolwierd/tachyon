import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { useTestDb } from "@/lib/db/test-utils";
import {
  collection,
  collectionSeries,
  libraryEntry,
  series,
  sourceMapping,
} from "@/lib/db/schema";
import { SOURCE } from "@/lib/library/shared";

const enqueueUpdateRunMock = vi.fn();
const listActiveRunsMock = vi.fn();
const requestCancelRunMock = vi.fn();
const listLibraryEntriesMock = vi.fn();

vi.mock("@/lib/background/enqueue", () => ({
  enqueueUpdateRun: enqueueUpdateRunMock,
}));

vi.mock("@/lib/background/queue", () => ({
  listActiveRuns: listActiveRunsMock,
  requestCancelRun: requestCancelRunMock,
}));

vi.mock("@/lib/library/state", () => ({
  listLibraryEntries: listLibraryEntriesMock,
}));

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function insertMappedSeries(sourceSeriesId: string) {
  const seriesId = id("local-series");
  getDb().insert(series).values({ id: seriesId, title: sourceSeriesId }).run();
  getDb().insert(sourceMapping).values({
    id: id("mapping"),
    seriesId,
    source: SOURCE,
    sourceSeriesId,
    sourceUrl: `https://example.test/${sourceSeriesId}`,
  }).run();

  return { seriesId, sourceSeriesId };
}

describe("background schedules", () => {
  useTestDb();

  beforeEach(() => {
    enqueueUpdateRunMock.mockReset();
    listActiveRunsMock.mockReset();
    requestCancelRunMock.mockReset();
    listLibraryEntriesMock.mockReset();

    listActiveRunsMock.mockReturnValue([]);
    enqueueUpdateRunMock.mockReturnValue({ id: id("run") });
    listLibraryEntriesMock.mockReturnValue([]);
  });

  it("creates rules with normalized interval/jitter and parses target value", async () => {
    const { createUpdateSchedule } = await import("./schedules");
    const created = createUpdateSchedule({
      name: id("rule-create"),
      enabled: true,
      targetType: "all",
      targetValue: { includeAdult: false },
      intervalMinutes: 0,
      jitterSeconds: 99999,
    });

    expect(created).not.toBeNull();
    expect(created?.intervalMinutes).toBe(1);
    expect(created?.jitterSeconds).toBe(3600);
    expect(created?.targetValue).toEqual({ includeAdult: false });
    expect(created?.nextRunAt).not.toBeNull();
  });

  it("patches rules and handles missing ids", async () => {
    const { createUpdateSchedule, patchUpdateSchedule } = await import("./schedules");
    const created = createUpdateSchedule({
      name: id("rule-patch"),
      enabled: true,
      targetType: "all",
      intervalMinutes: 60,
      jitterSeconds: 30,
    });

    const patched = patchUpdateSchedule(created!.id, {
      enabled: false,
      intervalMinutes: 99999,
      jitterSeconds: -5,
      targetValue: { collectionId: "col" },
    });

    expect(patched).not.toBeNull();
    expect(patched?.enabled).toBe(false);
    expect(patched?.intervalMinutes).toBe(24 * 60);
    expect(patched?.jitterSeconds).toBe(0);
    expect(patched?.nextRunAt).toBeNull();
    expect(patched?.targetValue).toEqual({ collectionId: "col" });

    expect(patchUpdateSchedule(id("missing-rule"), { enabled: true })).toBeNull();
  });

  it("runs collection-scoped rules and cancels overlapping runs", async () => {
    const { createUpdateSchedule, getUpdateSchedule, runUpdateRuleNow } = await import("./schedules");
    const sourceA = id("source-a");
    const sourceB = id("source-b");
    const mappedA = insertMappedSeries(sourceA);
    insertMappedSeries(sourceB);

    const collectionId = id("collection");
    getDb().insert(collection).values({ id: collectionId, name: collectionId }).run();
    getDb().insert(collectionSeries).values({
      collectionId,
      seriesId: mappedA.seriesId,
      sortOrder: 0,
    }).run();

    const schedule = createUpdateSchedule({
      name: id("rule-collection"),
      enabled: true,
      targetType: "collection",
      targetValue: { collectionId },
      intervalMinutes: 60,
    });

    listActiveRunsMock.mockReturnValue([
      {
        id: "active-match",
        scopeJson: JSON.stringify({ scheduleId: schedule!.id }),
      },
      {
        id: "active-other",
        scopeJson: JSON.stringify({ scheduleId: id("other") }),
      },
    ]);
    enqueueUpdateRunMock.mockReturnValue({ id: "run-collection" });

    const run = runUpdateRuleNow(schedule!.id, "manual");

    expect(requestCancelRunMock).toHaveBeenCalledWith("active-match");
    expect(enqueueUpdateRunMock).toHaveBeenCalledWith({
      sourceSeriesIds: [sourceA],
      trigger: "manual",
      reason: `schedule:${schedule!.id}`,
      scheduleId: schedule!.id,
    });
    expect(run).toEqual({ id: "run-collection" });

    const updated = getUpdateSchedule(schedule!.id);
    expect(updated?.lastRunId).toBe("run-collection");
    expect(updated?.lastRunAt).not.toBeNull();
  });

  it("resolves status-bucket and smart-unread targets", async () => {
    const { createUpdateSchedule, runUpdateRuleNow } = await import("./schedules");
    const readingSeries = insertMappedSeries(id("status-reading"));
    const completedSeries = insertMappedSeries(id("status-completed"));

    getDb().insert(libraryEntry).values({ seriesId: readingSeries.seriesId, status: "reading" }).run();
    getDb().insert(libraryEntry).values({ seriesId: completedSeries.seriesId, status: "completed" }).run();

    const statusRule = createUpdateSchedule({
      name: id("rule-status"),
      enabled: true,
      targetType: "status_bucket",
      targetValue: { statuses: ["reading"] },
      intervalMinutes: 120,
    });

    enqueueUpdateRunMock.mockReturnValueOnce({ id: "run-status" });
    runUpdateRuleNow(statusRule!.id, "manual");

    const statusCall = enqueueUpdateRunMock.mock.calls.at(-1)?.[0] as {
      sourceSeriesIds: string[];
      trigger: string;
      reason: string;
      scheduleId: string;
    };
    expect(statusCall.trigger).toBe("manual");
    expect(statusCall.reason).toBe(`schedule:${statusRule!.id}`);
    expect(statusCall.scheduleId).toBe(statusRule!.id);
    expect(statusCall.sourceSeriesIds).toContain(readingSeries.sourceSeriesId);
    expect(statusCall.sourceSeriesIds).not.toContain(completedSeries.sourceSeriesId);

    listLibraryEntriesMock.mockReturnValue([
      {
        sourceSeriesId: "smart-1",
        status: "reading",
        unreadChapters: 5,
      },
      {
        sourceSeriesId: "smart-2",
        status: "completed",
        unreadChapters: 10,
      },
      {
        sourceSeriesId: "smart-3",
        status: "dropped",
        unreadChapters: 8,
      },
      {
        sourceSeriesId: "smart-4",
        status: "planning",
        unreadChapters: 0,
      },
    ]);

    const smartRule = createUpdateSchedule({
      name: id("rule-smart"),
      enabled: true,
      targetType: "smart_unread",
      intervalMinutes: 180,
    });

    enqueueUpdateRunMock.mockReturnValueOnce({ id: "run-smart" });
    runUpdateRuleNow(smartRule!.id, "manual");

    expect(enqueueUpdateRunMock).toHaveBeenLastCalledWith({
      sourceSeriesIds: ["smart-1"],
      trigger: "manual",
      reason: `schedule:${smartRule!.id}`,
      scheduleId: smartRule!.id,
    });
  });
});
