import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { chapter, libraryEntry, series, sourceMapping } from "@/lib/db/schema";
import { getSeriesDetail, getChapterList } from "@/lib/sources/weebcentral";
import { logError, logWarn } from "@/lib/server/log";

export const runtime = "nodejs";

const SOURCE = "weebcentral" as const;

function normalizeStatus(status: string | null | undefined) {
  switch (status?.toLowerCase()) {
    case "ongoing": return "ongoing" as const;
    case "complete": case "completed": return "complete" as const;
    case "hiatus": return "hiatus" as const;
    case "canceled": case "cancelled": return "canceled" as const;
    default: return null;
  }
}

function normalizeContentType(type: string | null | undefined) {
  switch (type?.toLowerCase()) {
    case "manga": return "manga" as const;
    case "manhwa": return "manhwa" as const;
    case "manhua": return "manhua" as const;
    case "oel": return "oel" as const;
    default: return null;
  }
}

export async function POST() {
  try {
    const entries = getDb()
      .select({
        seriesId: series.id,
        sourceSeriesId: sourceMapping.sourceSeriesId,
        title: series.title,
      })
      .from(libraryEntry)
      .innerJoin(series, eq(libraryEntry.seriesId, series.id))
      .innerJoin(
        sourceMapping,
        and(eq(sourceMapping.seriesId, series.id), eq(sourceMapping.source, SOURCE)),
      )
      .all();

    const results: Array<{ sourceSeriesId: string; title: string; status: "ok" | "error"; error?: string; newChapters?: number }> = [];

    for (const entry of entries) {
      try {
        // Refresh series detail
        const detail = await getSeriesDetail(entry.sourceSeriesId);
        getDb()
          .update(series)
          .set({
            title: detail.title,
            description: detail.description,
            coverUrl: detail.coverUrl,
            status: normalizeStatus(detail.status),
            contentType: normalizeContentType(detail.type),
            year: detail.year,
            adult: detail.isAdult,
            updatedAt: new Date(),
          })
          .where(eq(series.id, entry.seriesId))
          .run();

        // Refresh chapters
        const chapters = await getChapterList(entry.sourceSeriesId);
        let newChapters = 0;
        const now = new Date();

        for (const ch of chapters) {
          const existing = getDb()
            .select({ id: chapter.id })
            .from(chapter)
            .where(
              and(
                eq(chapter.seriesId, entry.seriesId),
                eq(chapter.source, SOURCE),
                eq(chapter.sourceChapterId, ch.sourceChapterId),
              ),
            )
            .get();

          if (!existing) {
            getDb().insert(chapter).values({
              id: crypto.randomUUID(),
              seriesId: entry.seriesId,
              source: SOURCE,
              sourceChapterId: ch.sourceChapterId,
              chapterNo: ch.chapterNo,
              title: ch.title,
              pageCount: 0,
              sortKey: ch.chapterNo,
              createdAt: now,
            }).run();
            newChapters++;
          }
        }

        results.push({
          sourceSeriesId: entry.sourceSeriesId,
          title: entry.title,
          status: "ok",
          newChapters,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        logWarn("api.library.refresh.series_failed", {
          sourceSeriesId: entry.sourceSeriesId,
          error: msg,
        });
        results.push({
          sourceSeriesId: entry.sourceSeriesId,
          title: entry.title,
          status: "error",
          error: msg,
        });
      }
    }

    return NextResponse.json({
      total: entries.length,
      success: results.filter((r) => r.status === "ok").length,
      failed: results.filter((r) => r.status === "error").length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.library.refresh.failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
