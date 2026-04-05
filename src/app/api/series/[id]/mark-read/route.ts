import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { chapter, chapterProgress } from "@/lib/db/schema";
import { getSeriesMapping } from "@/lib/library/shared";
import {
  assertTrustedWriteRequest,
  handleApiError,
  notFound,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const markReadSchema = z.object({
  chapterIds: z.array(z.string().trim().min(1)).min(1).max(500),
  read: z.boolean().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertTrustedWriteRequest(request);
    const body = await parseJsonBody(request, markReadSchema);

    const chapterIds = body.chapterIds;
    const markRead = body.read !== false; // default true

    const mapping = getSeriesMapping(id);
    if (!mapping) {
      throw notFound("Series source not found", { code: "series_source_not_found" });
    }

    const seriesId = mapping.seriesId;
    const now = new Date();
    const updated = getDb().transaction((tx) => {
      const chapterRows = tx
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

      for (const row of chapterRows) {
        if (markRead) {
          tx
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
          tx
            .delete(chapterProgress)
            .where(eq(chapterProgress.chapterId, row.id))
            .run();
        }
      }

      return chapterRows.length;
    });

    return NextResponse.json({ updated, read: markRead });
  } catch (error) {
    const { id } = await context.params;
    return handleApiError("api.series.mark_read.failed", error, { sourceId: id });
  }
}
