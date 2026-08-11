import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { useTestDb } from "@/lib/db/test-utils";
import { chapter, libraryEntry, series, sourceMapping } from "@/lib/db/schema";
import { getLibraryEntry, upsertLibraryEntry } from "./state";

describe("library state", () => {
  useTestDb();

  it("returns an existing library entry when looked up by local series id", () => {
    const seriesId = `local-${crypto.randomUUID()}`;
    getDb().insert(series).values({
      id: seriesId,
      title: "One Piece",
      adult: false,
    }).run();
    getDb().insert(sourceMapping).values({
      id: `mapping-${crypto.randomUUID()}`,
      seriesId,
      source: "weebcentral",
      sourceSeriesId: "one-piece",
      sourceUrl: "https://example.test/one-piece",
    }).run();
    getDb().insert(libraryEntry).values({
      seriesId,
      status: "reading",
    }).run();

    const entry = getLibraryEntry(seriesId);

    expect(entry).toMatchObject({
      seriesId,
      sourceSeriesId: "one-piece",
      status: "reading",
      title: "One Piece",
    });
  });

  it("persists chapter publishedAt metadata from a library write", async () => {
    const publishedAt = Date.parse("2024-05-01T00:00:00.000Z");
    await upsertLibraryEntry({
      sourceSeriesId: "mgeko-series",
      sourceName: "mgeko",
      status: "planning",
      seriesDetail: {
        sourceId: "mgeko-series",
        source: "mgeko",
        title: "Mgeko Series",
        slug: "mgeko-series",
        coverUrl: "https://img.example/cover.jpg",
        description: "",
        authors: [],
        tags: [],
        type: "Manhwa",
        status: "Ongoing",
        year: null,
        isAdult: false,
        isOfficial: false,
        anilistUrl: null,
        relatedSeries: [],
      },
      chapters: [{
        sourceChapterId: "mgeko-series/chapter-1",
        chapterNo: 1,
        title: "Chapter 1",
        publishedAt,
      }],
    });

    const row = getDb()
      .select({ publishedAt: chapter.publishedAt })
      .from(chapter)
      .where(eq(chapter.sourceChapterId, "mgeko-series/chapter-1"))
      .get();

    expect(row?.publishedAt?.getTime()).toBe(publishedAt);
  });
});
