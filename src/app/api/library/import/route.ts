import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
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
import {
  assertTrustedWriteRequest,
  handleApiError,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50 MB

const seriesStatusEnum = z.enum(["ongoing", "complete", "hiatus", "canceled"]);
const contentTypeEnum = z.enum(["manga", "manhwa", "manhua", "oel"]);
const sourceEnum = z.enum([
  "weebcentral", "comix", "omegascans", "madaradex", "toonily",
  "oppai", "manhwa18", "hentai20", "asurascans", "flamecomics",
]);
const libraryStatusEnum = z.enum(["reading", "completed", "paused", "dropped", "rereading", "planning"]);
const tagTypeEnum = z.enum(["mood", "genre", "theme", "custom"]);
const readingDirectionEnum = z.enum(["ltr", "rtl", "vertical"]);
const fitModeEnum = z.enum(["width", "height", "original"]);

const backupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  data: z.object({
    series: z.array(z.object({
      id: z.string(),
      title: z.string(),
      altTitles: z.string().nullable().optional(),
      authors: z.string().nullable().optional(),
      sourceTags: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      coverUrl: z.string().nullable().optional(),
      anilistId: z.number().nullable().optional(),
      status: seriesStatusEnum.nullable().optional(),
      contentType: contentTypeEnum.nullable().optional(),
      year: z.number().nullable().optional(),
      adult: z.union([z.boolean(), z.number()]).nullable().optional(),
    })),
    sourceMappings: z.array(z.object({
      seriesId: z.string(),
      source: sourceEnum,
      sourceSeriesId: z.string(),
      sourceUrl: z.string().nullable().optional(),
    })),
    libraryEntries: z.array(z.object({
      seriesId: z.string(),
      status: libraryStatusEnum,
      addedAt: z.any().nullable().optional(),
      updatedAt: z.any().nullable().optional(),
      rating: z.number().nullable().optional(),
      favorite: z.union([z.boolean(), z.number()]).nullable().optional(),
    })),
    readingProgress: z.array(z.object({
      seriesId: z.string(),
      currentChapterId: z.string().nullable().optional(),
      currentPage: z.number().nullable().optional(),
      updatedAt: z.any().nullable().optional(),
    })),
    chapters: z.array(z.object({
      id: z.string(),
      seriesId: z.string(),
      source: z.string(),
      sourceChapterId: z.string(),
      chapterNo: z.number(),
      volumeNo: z.number().nullable().optional(),
      title: z.string().nullable().optional(),
      pageCount: z.number().nullable().optional(),
      sortKey: z.number(),
    })),
    chapterProgress: z.array(z.object({
      chapterId: z.string(),
      seriesId: z.string(),
      lastPage: z.number().nullable().optional(),
      completed: z.union([z.boolean(), z.number()]).nullable().optional(),
      startedAt: z.any().nullable().optional(),
      completedAt: z.any().nullable().optional(),
    })),
    tags: z.array(z.object({
      id: z.string(),
      name: z.string(),
      color: z.string().nullable().optional(),
      type: tagTypeEnum,
    })),
    seriesTags: z.array(z.object({
      seriesId: z.string(),
      tagId: z.string(),
    })),
    bookmarks: z.array(z.object({
      seriesId: z.string(),
      chapterId: z.string(),
      pageIndex: z.number(),
      label: z.string().nullable().optional(),
    })),
    notes: z.array(z.object({
      seriesId: z.string(),
      chapterId: z.string().nullable().optional(),
      pageIndex: z.number().nullable().optional(),
      body: z.string(),
    })),
    seriesPreferences: z.array(z.object({
      seriesId: z.string(),
      readingDirection: readingDirectionEnum.nullable().optional(),
      fitMode: fitModeEnum.nullable().optional(),
    })),
    downloadPolicies: z.array(z.object({
      seriesId: z.string(),
      sourceSeriesId: z.string(),
      autoDownloadNewEnabled: z.union([z.boolean(), z.number()]).nullable().optional(),
      autoDownloadNewLimit: z.number().nullable().optional(),
    })),
  }),
});

type BackupData = z.infer<typeof backupSchema>;

export async function POST(request: Request) {
  try {
    assertTrustedWriteRequest(request);

    const backup = await parseJsonBody(request, backupSchema, {
      maxBytes: MAX_BODY_BYTES,
    });

    const counts = await importBackup(backup);

    return NextResponse.json({ imported: counts });
  } catch (error) {
    return handleApiError("api.library.import.failed", error);
  }
}

async function importBackup(backup: BackupData) {
  const db = getDb();
  const { data } = backup;

  const counts = {
    series: 0,
    sourceMappings: 0,
    libraryEntries: 0,
    readingProgress: 0,
    chapters: 0,
    chapterProgress: 0,
    tags: 0,
    seriesTags: 0,
    bookmarks: 0,
    notes: 0,
    seriesPreferences: 0,
    downloadPolicies: 0,
  };

  db.transaction((tx) => {
    // 1. Series (must come first — other tables reference series.id)
    for (const row of data.series) {
      tx.insert(series)
        .values({
          id: row.id,
          title: row.title,
          altTitles: row.altTitles ?? null,
          authors: row.authors ?? null,
          sourceTags: row.sourceTags ?? null,
          description: row.description ?? null,
          coverUrl: row.coverUrl ?? null,
          anilistId: row.anilistId ?? null,
          status: row.status ?? null,
          contentType: row.contentType ?? null,
          year: row.year ?? null,
          adult: row.adult != null ? Boolean(row.adult) : null,
        })
        .onConflictDoUpdate({
          target: series.id,
          set: {
            title: row.title,
            altTitles: row.altTitles ?? null,
            authors: row.authors ?? null,
            sourceTags: row.sourceTags ?? null,
            description: row.description ?? null,
            coverUrl: row.coverUrl ?? null,
            anilistId: row.anilistId ?? null,
            status: row.status ?? null,
            contentType: row.contentType ?? null,
            year: row.year ?? null,
            adult: row.adult != null ? Boolean(row.adult) : null,
          },
        })
        .run();
      counts.series++;
    }

    // 2. Source mappings
    for (const row of data.sourceMappings) {
      tx.insert(sourceMapping)
        .values({
          seriesId: row.seriesId,
          source: row.source,
          sourceSeriesId: row.sourceSeriesId,
          sourceUrl: row.sourceUrl ?? null,
        })
        .onConflictDoUpdate({
          target: [sourceMapping.source, sourceMapping.sourceSeriesId],
          set: {
            seriesId: row.seriesId,
            sourceUrl: row.sourceUrl ?? null,
          },
        })
        .run();
      counts.sourceMappings++;
    }

    // 3. Chapters (must come before chapterProgress, readingProgress, bookmarks, notes)
    for (const row of data.chapters) {
      tx.insert(chapter)
        .values({
          id: row.id,
          seriesId: row.seriesId,
          source: row.source,
          sourceChapterId: row.sourceChapterId,
          chapterNo: row.chapterNo,
          volumeNo: row.volumeNo ?? null,
          title: row.title ?? null,
          pageCount: row.pageCount ?? 0,
          sortKey: row.sortKey,
        })
        .onConflictDoUpdate({
          target: chapter.id,
          set: {
            seriesId: row.seriesId,
            source: row.source,
            sourceChapterId: row.sourceChapterId,
            chapterNo: row.chapterNo,
            volumeNo: row.volumeNo ?? null,
            title: row.title ?? null,
            pageCount: row.pageCount ?? 0,
            sortKey: row.sortKey,
          },
        })
        .run();
      counts.chapters++;
    }

    // 4. Library entries
    for (const row of data.libraryEntries) {
      tx.insert(libraryEntry)
        .values({
          seriesId: row.seriesId,
          status: row.status,
          rating: row.rating ?? null,
          favorite: row.favorite != null ? Boolean(row.favorite) : false,
        })
        .onConflictDoUpdate({
          target: libraryEntry.seriesId,
          set: {
            status: row.status,
            rating: row.rating ?? null,
            favorite: row.favorite != null ? Boolean(row.favorite) : false,
          },
        })
        .run();
      counts.libraryEntries++;
    }

    // 5. Reading progress
    for (const row of data.readingProgress) {
      tx.insert(readingProgress)
        .values({
          seriesId: row.seriesId,
          currentChapterId: row.currentChapterId ?? null,
          currentPage: row.currentPage ?? 0,
        })
        .onConflictDoUpdate({
          target: readingProgress.seriesId,
          set: {
            currentChapterId: row.currentChapterId ?? null,
            currentPage: row.currentPage ?? 0,
          },
        })
        .run();
      counts.readingProgress++;
    }

    // 6. Chapter progress
    for (const row of data.chapterProgress) {
      const startedAt = row.startedAt ? new Date(row.startedAt) : null;
      const completedAt = row.completedAt ? new Date(row.completedAt) : null;
      tx.insert(chapterProgress)
        .values({
          chapterId: row.chapterId,
          seriesId: row.seriesId,
          lastPage: row.lastPage ?? 0,
          completed: row.completed != null ? Boolean(row.completed) : false,
          startedAt,
          completedAt,
        })
        .onConflictDoUpdate({
          target: chapterProgress.chapterId,
          set: {
            seriesId: row.seriesId,
            lastPage: row.lastPage ?? 0,
            completed: row.completed != null ? Boolean(row.completed) : false,
            startedAt,
            completedAt,
          },
        })
        .run();
      counts.chapterProgress++;
    }

    // 7. Tags
    for (const row of data.tags) {
      tx.insert(tag)
        .values({
          id: row.id,
          name: row.name,
          color: row.color ?? null,
          type: row.type,
        })
        .onConflictDoUpdate({
          target: tag.id,
          set: {
            name: row.name,
            color: row.color ?? null,
            type: row.type,
          },
        })
        .run();
      counts.tags++;
    }

    // 8. Series tags (composite PK)
    for (const row of data.seriesTags) {
      tx.insert(seriesTag)
        .values({
          seriesId: row.seriesId,
          tagId: row.tagId,
        })
        .onConflictDoUpdate({
          target: [seriesTag.seriesId, seriesTag.tagId],
          set: {
            seriesId: row.seriesId,
          },
        })
        .run();
      counts.seriesTags++;
    }

    // 9. Bookmarks — clear existing for imported series, then re-insert
    const importedSeriesIds = new Set(data.series.map((s) => s.id));
    if (data.bookmarks.length > 0) {
      for (const sid of importedSeriesIds) {
        tx.delete(bookmark).where(eq(bookmark.seriesId, sid)).run();
      }
    }
    for (const row of data.bookmarks) {
      tx.insert(bookmark)
        .values({
          seriesId: row.seriesId,
          chapterId: row.chapterId,
          pageIndex: row.pageIndex,
          label: row.label ?? null,
        })
        .run();
      counts.bookmarks++;
    }

    // 10. Notes — clear existing for imported series, then re-insert
    if (data.notes.length > 0) {
      for (const sid of importedSeriesIds) {
        tx.delete(note).where(eq(note.seriesId, sid)).run();
      }
    }
    for (const row of data.notes) {
      tx.insert(note)
        .values({
          seriesId: row.seriesId,
          chapterId: row.chapterId ?? null,
          pageIndex: row.pageIndex ?? null,
          body: row.body,
        })
        .run();
      counts.notes++;
    }

    // 11. Series preferences
    for (const row of data.seriesPreferences) {
      tx.insert(seriesPreferences)
        .values({
          seriesId: row.seriesId,
          readingDirection: row.readingDirection ?? "vertical",
          fitMode: row.fitMode ?? "width",
        })
        .onConflictDoUpdate({
          target: seriesPreferences.seriesId,
          set: {
            readingDirection: row.readingDirection ?? "vertical",
            fitMode: row.fitMode ?? "width",
          },
        })
        .run();
      counts.seriesPreferences++;
    }

    // 12. Download policies
    for (const row of data.downloadPolicies) {
      tx.insert(seriesDownloadPolicy)
        .values({
          seriesId: row.seriesId,
          sourceSeriesId: row.sourceSeriesId,
          autoDownloadNewEnabled: row.autoDownloadNewEnabled != null ? Boolean(row.autoDownloadNewEnabled) : false,
          autoDownloadNewLimit: row.autoDownloadNewLimit ?? 3,
        })
        .onConflictDoUpdate({
          target: seriesDownloadPolicy.seriesId,
          set: {
            sourceSeriesId: row.sourceSeriesId,
            autoDownloadNewEnabled: row.autoDownloadNewEnabled != null ? Boolean(row.autoDownloadNewEnabled) : false,
            autoDownloadNewLimit: row.autoDownloadNewLimit ?? 3,
          },
        })
        .run();
      counts.downloadPolicies++;
    }
  });

  return counts;
}
