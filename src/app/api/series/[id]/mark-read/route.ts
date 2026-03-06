import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { chapter, chapterProgress } from "@/lib/db/schema";
import { getSeriesMapping } from "@/lib/library/shared";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      chapterIds?: string[];
      read?: boolean;
    };

    const chapterIds = body.chapterIds;
    const markRead = body.read !== false; // default true

    if (!Array.isArray(chapterIds) || chapterIds.length === 0) {
      return NextResponse.json({ error: "chapterIds array is required" }, { status: 400 });
    }

    const mapping = getSeriesMapping(id);
    if (!mapping) {
      return NextResponse.json({ error: "Series source not found" }, { status: 404 });
    }

    const seriesId = mapping.seriesId;
    const now = new Date();

    // Resolve source chapter IDs to internal chapter IDs
    const chapterRows = getDb()
      .select({ id: chapter.id, sourceChapterId: chapter.sourceChapterId })
      .from(chapter)
      .where(
        and(
          eq(chapter.seriesId, seriesId),
          eq(chapter.source, mapping.source),
          inArray(chapter.sourceChapterId, chapterIds),
        ),
      )
      .all();

    let updated = 0;

    for (const row of chapterRows) {
      if (markRead) {
        getDb()
          .insert(chapterProgress)
          .values({
            chapterId: row.id,
            seriesId,
            lastPage: 0,
            completed: true,
            startedAt: now,
            completedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: chapterProgress.chapterId,
            set: {
              completed: true,
              completedAt: now,
              updatedAt: now,
            },
          })
          .run();
      } else {
        getDb()
          .delete(chapterProgress)
          .where(eq(chapterProgress.chapterId, row.id))
          .run();
      }
      updated++;
    }

    return NextResponse.json({ updated, read: markRead });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.series.mark_read.failed", error, { sourceId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
