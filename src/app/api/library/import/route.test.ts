import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { useTestDb } from "@/lib/db/test-utils";
import {
  series,
  libraryEntry,
  chapter,
  chapterProgress,
  tag,
  seriesTag,
  seriesPreferences,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const SAME_ORIGIN_HEADERS = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
};

function makeBackup(overrides?: Record<string, unknown>) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      series: [],
      sourceMappings: [],
      libraryEntries: [],
      readingProgress: [],
      chapters: [],
      chapterProgress: [],
      tags: [],
      seriesTags: [],
      bookmarks: [],
      notes: [],
      seriesPreferences: [],
      downloadPolicies: [],
      ...overrides,
    },
  };
}

function makePostRequest(body: unknown) {
  return new NextRequest("http://localhost/api/library/import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...SAME_ORIGIN_HEADERS,
    },
    body: JSON.stringify(body),
  });
}

describe("library import API", () => {
  useTestDb();

  it("rejects invalid backup format", async () => {
    const { POST } = await import("./route");
    const response = await POST(makePostRequest({ version: 99 }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("invalid_body");
  });

  it("rejects cross-origin requests", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/library/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          origin: "http://evil.example.com",
          "sec-fetch-site": "cross-site",
        },
        body: JSON.stringify(makeBackup()),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("imports an empty backup", async () => {
    const { POST } = await import("./route");
    const response = await POST(makePostRequest(makeBackup()));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.imported.series).toBe(0);
    expect(body.imported.chapters).toBe(0);
  });

  it("imports series, chapters, and progress", async () => {
    const backup = makeBackup({
      series: [
        {
          id: "s-1",
          title: "Imported Series",
          altTitles: null,
          authors: null,
          sourceTags: null,
          description: null,
          coverUrl: null,
          anilistId: null,
          status: "ongoing",
          contentType: "manga",
          year: 2023,
          adult: false,
        },
      ],
      chapters: [
        {
          id: "ch-1",
          seriesId: "s-1",
          source: "weebcentral",
          sourceChapterId: "wc-ch-1",
          chapterNo: 1,
          volumeNo: null,
          title: "Chapter 1",
          pageCount: 20,
          sortKey: 1,
        },
      ],
      libraryEntries: [
        {
          seriesId: "s-1",
          status: "reading",
          addedAt: null,
          updatedAt: null,
          rating: 9,
          favorite: true,
        },
      ],
      chapterProgress: [
        {
          chapterId: "ch-1",
          seriesId: "s-1",
          lastPage: 15,
          completed: false,
          startedAt: null,
          completedAt: null,
        },
      ],
    });

    const { POST } = await import("./route");
    const response = await POST(makePostRequest(backup));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.imported.series).toBe(1);
    expect(body.imported.chapters).toBe(1);
    expect(body.imported.libraryEntries).toBe(1);
    expect(body.imported.chapterProgress).toBe(1);

    // Verify data was actually persisted
    const db = getDb();
    const allSeries = db.select().from(series).all();
    expect(allSeries).toHaveLength(1);
    expect(allSeries[0].title).toBe("Imported Series");

    const allChapters = db.select().from(chapter).all();
    expect(allChapters).toHaveLength(1);
    expect(allChapters[0].chapterNo).toBe(1);
  });

  it("merges (upserts) when reimporting", async () => {
    const db = getDb();

    // Pre-populate with existing data
    db.insert(series).values({
      id: "s-1",
      title: "Old Title",
      adult: false,
    }).run();
    db.insert(libraryEntry).values({
      seriesId: "s-1",
      status: "planning",
    }).run();

    // Import with updated data
    const backup = makeBackup({
      series: [
        {
          id: "s-1",
          title: "Updated Title",
          altTitles: null,
          authors: null,
          sourceTags: null,
          description: null,
          coverUrl: null,
          anilistId: null,
          status: "ongoing",
          contentType: "manga",
          year: null,
          adult: false,
        },
      ],
      libraryEntries: [
        {
          seriesId: "s-1",
          status: "reading",
          addedAt: null,
          updatedAt: null,
          rating: 7,
          favorite: false,
        },
      ],
    });

    const { POST } = await import("./route");
    const response = await POST(makePostRequest(backup));

    expect(response.status).toBe(200);

    // Series should be updated, not duplicated
    const allSeries = db.select().from(series).all();
    expect(allSeries).toHaveLength(1);
    expect(allSeries[0].title).toBe("Updated Title");

    // Library entry should be updated
    const entry = db.select().from(libraryEntry).where(eq(libraryEntry.seriesId, "s-1")).get();
    expect(entry?.status).toBe("reading");
    expect(entry?.rating).toBe(7);
  });

  it("imports tags and series-tag associations", async () => {
    const db = getDb();

    db.insert(series).values({ id: "s-1", title: "Test", adult: false }).run();

    const backup = makeBackup({
      tags: [
        { id: "t-1", name: "Action", color: "#ff0000", type: "genre" },
        { id: "t-2", name: "Cozy", color: null, type: "mood" },
      ],
      seriesTags: [
        { seriesId: "s-1", tagId: "t-1" },
      ],
    });

    const { POST } = await import("./route");
    const response = await POST(makePostRequest(backup));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.imported.tags).toBe(2);
    expect(body.imported.seriesTags).toBe(1);

    const allTags = db.select().from(tag).all();
    expect(allTags).toHaveLength(2);

    const associations = db.select().from(seriesTag).all();
    expect(associations).toHaveLength(1);
  });

  it("imports series preferences", async () => {
    const db = getDb();
    db.insert(series).values({ id: "s-1", title: "Test", adult: false }).run();

    const backup = makeBackup({
      seriesPreferences: [
        { seriesId: "s-1", readingDirection: "rtl", fitMode: "height" },
      ],
    });

    const { POST } = await import("./route");
    const response = await POST(makePostRequest(backup));

    expect(response.status).toBe(200);

    const prefs = db.select().from(seriesPreferences).where(eq(seriesPreferences.seriesId, "s-1")).get();
    expect(prefs?.readingDirection).toBe("rtl");
    expect(prefs?.fitMode).toBe("height");
  });
});
