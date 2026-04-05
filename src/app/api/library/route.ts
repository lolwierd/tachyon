import { NextResponse } from "next/server";
import { z } from "zod";
import { listLibraryEntries, upsertLibraryEntry } from "@/lib/library/state";
import type { Chapter, SeriesDetail } from "@/lib/sources/types";
import "@/lib/sources/init";
import {
  assertTrustedWriteRequest,
  handleApiError,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const LIBRARY_STATUS_VALUES = [
  "reading",
  "completed",
  "paused",
  "dropped",
  "rereading",
  "planning",
] as const;

const seriesDetailSchema: z.ZodType<SeriesDetail> = z.object({
  sourceId: z.string().trim().min(1),
  source: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  coverUrl: z.string().trim().min(1),
  description: z.string(),
  authors: z.array(z.string()),
  tags: z.array(z.string()),
  type: z.string(),
  status: z.string(),
  year: z.number().nullable(),
  isAdult: z.boolean(),
  isOfficial: z.boolean(),
  anilistUrl: z.string().nullable(),
  relatedSeries: z.array(z.object({
    sourceId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    relationship: z.string().trim().min(1),
  })),
});

const chapterSchema: z.ZodType<Pick<Chapter, "sourceChapterId" | "chapterNo" | "title">> = z.object({
  sourceChapterId: z.string().trim().min(1),
  chapterNo: z.number(),
  title: z.string().trim().min(1),
});

const upsertLibraryEntrySchema = z.object({
  seriesId: z.string().trim().min(1),
  source: z.string().trim().min(1).optional(),
  status: z.enum(LIBRARY_STATUS_VALUES),
  series: seriesDetailSchema.optional(),
  chapters: z.array(chapterSchema).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeNsfw = searchParams.get("nsfw") === "1";
    return NextResponse.json(listLibraryEntries({ includeNsfw }));
  } catch (error) {
    return handleApiError("api.library.list.failed", error, { url: request.url });
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    const body = await parseJsonBody(request, upsertLibraryEntrySchema);

    const entry = await upsertLibraryEntry({
      sourceSeriesId: body.seriesId,
      status: body.status,
      seriesDetail: body.series,
      chapters: body.chapters,
      sourceName: body.source,
    });

    if (!entry) {
      throw new Error("Failed to save library entry");
    }

    return NextResponse.json(entry);
  } catch (error) {
    return handleApiError("api.library.upsert.failed", error, { url: request.url });
  }
}
