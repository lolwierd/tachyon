import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { useTestDb } from "@/lib/db/test-utils";
import {
  series,
  sourceMapping,
  libraryEntry,
  readingProgress,
  chapter,
  chapterProgress,
  tag,
  seriesTag,
  bookmark,
  note,
  seriesPreferences,
  seriesDownloadPolicy,
} from "@/lib/db/schema";

describe("library export API", () => {
  useTestDb();

  it("exports an empty library", async () => {
    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="tachyon-backup-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.headers.get("content-type")).toBe("application/json");

    const body = await response.json();
    expect(body.version).toBe(1);
    expect(body.exportedAt).toBeTruthy();
    expect(body.data.series).toEqual([]);
    expect(body.data.chapters).toEqual([]);
    expect(body.data.libraryEntries).toEqual([]);
    expect(body.data.tags).toEqual([]);
  });

  it("exports populated library data", async () => {
    const db = getDb();
    const seriesId = "series-1";
    const chapterId = "chapter-1";
    const tagId = "tag-1";

    db.insert(series).values({
      id: seriesId,
      title: "Test Series",
      adult: false,
      status: "ongoing",
      contentType: "manga",
    }).run();

    db.insert(sourceMapping).values({
      id: "mapping-1",
      seriesId,
      source: "weebcentral",
      sourceSeriesId: "test-series",
      sourceUrl: "https://example.test/test-series",
    }).run();

    db.insert(libraryEntry).values({
      seriesId,
      status: "reading",
      rating: 8,
      favorite: true,
    }).run();

    db.insert(chapter).values({
      id: chapterId,
      seriesId,
      source: "weebcentral",
      sourceChapterId: "ch-1",
      chapterNo: 1,
      sortKey: 1,
      pageCount: 20,
    }).run();

    db.insert(readingProgress).values({
      seriesId,
      currentChapterId: chapterId,
      currentPage: 5,
    }).run();

    db.insert(chapterProgress).values({
      chapterId,
      seriesId,
      lastPage: 10,
      completed: false,
    }).run();

    db.insert(tag).values({
      id: tagId,
      name: "Action",
      color: "#ff0000",
      type: "genre",
    }).run();

    db.insert(seriesTag).values({
      seriesId,
      tagId,
    }).run();

    db.insert(bookmark).values({
      id: "bm-1",
      seriesId,
      chapterId,
      pageIndex: 3,
      label: "Cool panel",
    }).run();

    db.insert(note).values({
      id: "note-1",
      seriesId,
      chapterId,
      pageIndex: 5,
      body: "Great page",
    }).run();

    db.insert(seriesPreferences).values({
      seriesId,
      readingDirection: "rtl",
      fitMode: "width",
    }).run();

    db.insert(seriesDownloadPolicy).values({
      seriesId,
      sourceSeriesId: "test-series",
      autoDownloadNewEnabled: true,
      autoDownloadNewLimit: 5,
    }).run();

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.version).toBe(1);
    expect(body.data.series).toHaveLength(1);
    expect(body.data.series[0].title).toBe("Test Series");
    expect(body.data.sourceMappings).toHaveLength(1);
    expect(body.data.libraryEntries).toHaveLength(1);
    expect(body.data.libraryEntries[0].rating).toBe(8);
    expect(body.data.chapters).toHaveLength(1);
    expect(body.data.readingProgress).toHaveLength(1);
    expect(body.data.readingProgress[0].currentPage).toBe(5);
    expect(body.data.chapterProgress).toHaveLength(1);
    expect(body.data.tags).toHaveLength(1);
    expect(body.data.seriesTags).toHaveLength(1);
    expect(body.data.bookmarks).toHaveLength(1);
    expect(body.data.bookmarks[0].label).toBe("Cool panel");
    expect(body.data.notes).toHaveLength(1);
    expect(body.data.seriesPreferences).toHaveLength(1);
    expect(body.data.seriesPreferences[0].readingDirection).toBe("rtl");
    expect(body.data.downloadPolicies).toHaveLength(1);
    expect(body.data.downloadPolicies[0].autoDownloadNewLimit).toBe(5);
  });
});
