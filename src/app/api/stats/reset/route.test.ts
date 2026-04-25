import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { useTestDb } from "@/lib/db/test-utils";
import {
  activityEvent,
  chapter,
  chapterProgress,
  libraryEntry,
  readingProgress,
  series,
} from "@/lib/db/schema";

const SAME_ORIGIN_HEADERS = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
};

function makePostRequest() {
  return new NextRequest("http://localhost/api/stats/reset", {
    method: "POST",
    headers: SAME_ORIGIN_HEADERS,
  });
}

describe("POST /api/stats/reset", () => {
  useTestDb();

  it("rejects cross-origin requests", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/stats/reset", {
        method: "POST",
        headers: {
          origin: "http://evil.example.com",
          "sec-fetch-site": "cross-site",
        },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("clears chapter progress, reading progress, and activity events", async () => {
    const db = getDb();

    db.insert(series)
      .values({
        id: "s-1",
        title: "Test Series",
        adult: false,
      })
      .run();

    db.insert(chapter)
      .values({
        id: "ch-1",
        seriesId: "s-1",
        source: "weebcentral",
        sourceChapterId: "wc-1",
        chapterNo: 1,
        pageCount: 20,
        sortKey: 1,
      })
      .run();

    db.insert(libraryEntry)
      .values({
        seriesId: "s-1",
        status: "reading",
      })
      .run();

    db.insert(chapterProgress)
      .values({
        chapterId: "ch-1",
        seriesId: "s-1",
        lastPage: 20,
        completed: true,
        completedAt: new Date(),
      })
      .run();

    db.insert(readingProgress)
      .values({
        seriesId: "s-1",
        currentChapterId: "ch-1",
        currentPage: 20,
      })
      .run();

    db.insert(activityEvent)
      .values({
        id: "ae-1",
        type: "chapter_completed",
        seriesId: "s-1",
        chapterId: "ch-1",
      })
      .run();

    const { POST } = await import("./route");
    const response = await POST(makePostRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    expect(db.select().from(chapterProgress).all()).toHaveLength(0);
    expect(db.select().from(readingProgress).all()).toHaveLength(0);
    expect(db.select().from(activityEvent).all()).toHaveLength(0);

    // Library entries and series should be untouched
    expect(db.select().from(series).all()).toHaveLength(1);
    expect(db.select().from(libraryEntry).all()).toHaveLength(1);
  });
});
