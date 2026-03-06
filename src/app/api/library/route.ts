import { NextResponse } from "next/server";
import { listLibraryEntries, upsertLibraryEntry } from "@/lib/library/state";
import type { Chapter, SeriesDetail } from "@/lib/sources/types";
import "@/lib/sources/init";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

const LIBRARY_STATUSES = new Set([
  "reading",
  "completed",
  "paused",
  "dropped",
  "rereading",
  "planning",
] as const);

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isSeriesDetail(value: unknown): value is SeriesDetail {
  if (!value || typeof value !== "object") {
    return false;
  }

  const detail = value as Partial<SeriesDetail>;
  return (
    typeof detail.sourceId === "string" &&
    typeof detail.title === "string" &&
    typeof detail.slug === "string" &&
    typeof detail.coverUrl === "string" &&
    typeof detail.description === "string" &&
    Array.isArray(detail.authors) &&
    Array.isArray(detail.tags) &&
    typeof detail.type === "string" &&
    typeof detail.status === "string" &&
    (typeof detail.year === "number" || detail.year === null) &&
    typeof detail.isAdult === "boolean" &&
    typeof detail.isOfficial === "boolean" &&
    (typeof detail.anilistUrl === "string" || detail.anilistUrl === null) &&
    Array.isArray(detail.relatedSeries)
  );
}

function isChapterList(value: unknown): value is Pick<Chapter, "sourceChapterId" | "chapterNo" | "title">[] {
  return (
    Array.isArray(value) &&
    value.every(
      (chapter) =>
        chapter &&
        typeof chapter === "object" &&
        typeof chapter.sourceChapterId === "string" &&
        typeof chapter.chapterNo === "number" &&
        typeof chapter.title === "string",
    )
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const includeNsfw = searchParams.get("nsfw") === "1";
    return NextResponse.json(listLibraryEntries({ includeNsfw }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.library.list.failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const seriesId = typeof body.seriesId === "string" ? body.seriesId : null;
    const status =
      typeof body.status === "string" && LIBRARY_STATUSES.has(body.status as never)
        ? body.status
        : null;

    if (!seriesId || !status) {
      return badRequest("seriesId and status are required");
    }

    return NextResponse.json(
      await upsertLibraryEntry({
        sourceSeriesId: seriesId,
        status,
        seriesDetail: isSeriesDetail(body.series) ? body.series : undefined,
        chapters: isChapterList(body.chapters) ? body.chapters : undefined,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.library.upsert.failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
