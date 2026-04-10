import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
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
import { handleApiError } from "@/lib/server/api";

export const runtime = "nodejs";

export async function GET() {
  try {
    const db = getDb();

    const [
      allSeries,
      allSourceMappings,
      allLibraryEntries,
      allReadingProgress,
      allChapters,
      allChapterProgress,
      allTags,
      allSeriesTags,
      allBookmarks,
      allNotes,
      allSeriesPreferences,
      allDownloadPolicies,
    ] = await Promise.all([
      db.select({
        id: series.id,
        title: series.title,
        altTitles: series.altTitles,
        authors: series.authors,
        sourceTags: series.sourceTags,
        description: series.description,
        coverUrl: series.coverUrl,
        anilistId: series.anilistId,
        status: series.status,
        contentType: series.contentType,
        year: series.year,
        adult: series.adult,
      }).from(series),

      db.select({
        seriesId: sourceMapping.seriesId,
        source: sourceMapping.source,
        sourceSeriesId: sourceMapping.sourceSeriesId,
        sourceUrl: sourceMapping.sourceUrl,
      }).from(sourceMapping),

      db.select({
        seriesId: libraryEntry.seriesId,
        status: libraryEntry.status,
        addedAt: libraryEntry.addedAt,
        updatedAt: libraryEntry.updatedAt,
        rating: libraryEntry.rating,
        favorite: libraryEntry.favorite,
      }).from(libraryEntry),

      db.select({
        seriesId: readingProgress.seriesId,
        currentChapterId: readingProgress.currentChapterId,
        currentPage: readingProgress.currentPage,
        updatedAt: readingProgress.updatedAt,
      }).from(readingProgress),

      db.select({
        id: chapter.id,
        seriesId: chapter.seriesId,
        source: chapter.source,
        sourceChapterId: chapter.sourceChapterId,
        chapterNo: chapter.chapterNo,
        volumeNo: chapter.volumeNo,
        title: chapter.title,
        pageCount: chapter.pageCount,
        sortKey: chapter.sortKey,
      }).from(chapter),

      db.select({
        chapterId: chapterProgress.chapterId,
        seriesId: chapterProgress.seriesId,
        lastPage: chapterProgress.lastPage,
        completed: chapterProgress.completed,
        startedAt: chapterProgress.startedAt,
        completedAt: chapterProgress.completedAt,
      }).from(chapterProgress),

      db.select({
        id: tag.id,
        name: tag.name,
        color: tag.color,
        type: tag.type,
      }).from(tag),

      db.select({
        seriesId: seriesTag.seriesId,
        tagId: seriesTag.tagId,
      }).from(seriesTag),

      db.select({
        seriesId: bookmark.seriesId,
        chapterId: bookmark.chapterId,
        pageIndex: bookmark.pageIndex,
        label: bookmark.label,
        createdAt: bookmark.createdAt,
      }).from(bookmark),

      db.select({
        seriesId: note.seriesId,
        chapterId: note.chapterId,
        pageIndex: note.pageIndex,
        body: note.body,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      }).from(note),

      db.select({
        seriesId: seriesPreferences.seriesId,
        readingDirection: seriesPreferences.readingDirection,
        fitMode: seriesPreferences.fitMode,
      }).from(seriesPreferences),

      db.select({
        seriesId: seriesDownloadPolicy.seriesId,
        sourceSeriesId: seriesDownloadPolicy.sourceSeriesId,
        autoDownloadNewEnabled: seriesDownloadPolicy.autoDownloadNewEnabled,
        autoDownloadNewLimit: seriesDownloadPolicy.autoDownloadNewLimit,
      }).from(seriesDownloadPolicy),
    ]);

    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        series: allSeries,
        sourceMappings: allSourceMappings,
        libraryEntries: allLibraryEntries,
        readingProgress: allReadingProgress,
        chapters: allChapters,
        chapterProgress: allChapterProgress,
        tags: allTags,
        seriesTags: allSeriesTags,
        bookmarks: allBookmarks,
        notes: allNotes,
        seriesPreferences: allSeriesPreferences,
        downloadPolicies: allDownloadPolicies,
      },
    };

    const date = new Date().toISOString().slice(0, 10);

    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="tachyon-backup-${date}.json"`,
      },
    });
  } catch (error) {
    return handleApiError("api.library.export.failed", error);
  }
}
