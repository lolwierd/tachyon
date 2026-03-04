import { NextResponse } from "next/server";
import {
  getReaderState,
  saveReaderProgress,
  updateReaderPreferences,
} from "@/lib/reader/state";

export const runtime = "nodejs";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const seriesId = searchParams.get("seriesId");
    const chapterId = searchParams.get("chapterId");

    if (!seriesId || !chapterId) {
      return badRequest("seriesId and chapterId are required");
    }

    return NextResponse.json(getReaderState(seriesId, chapterId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const seriesId = typeof body.seriesId === "string" ? body.seriesId : null;
    const chapterId = typeof body.chapterId === "string" ? body.chapterId : null;
    const pageCount = typeof body.pageCount === "number" ? body.pageCount : null;
    const currentPage = typeof body.currentPage === "number" ? body.currentPage : null;

    if (!seriesId || !chapterId || pageCount == null || currentPage == null) {
      return badRequest("seriesId, chapterId, pageCount, and currentPage are required");
    }

    const state = await saveReaderProgress({
      sourceSeriesId: seriesId,
      sourceChapterId: chapterId,
      chapterTitle: typeof body.chapterTitle === "string" ? body.chapterTitle : undefined,
      chapterNo: typeof body.chapterNo === "number" ? body.chapterNo : undefined,
      pageCount,
      currentPage,
      completed: typeof body.completed === "boolean" ? body.completed : undefined,
    });

    return NextResponse.json(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const seriesId = typeof body.seriesId === "string" ? body.seriesId : null;
    const readingDirection =
      body.readingDirection === "vertical" ||
      body.readingDirection === "ltr" ||
      body.readingDirection === "rtl"
        ? body.readingDirection
        : null;
    const fitMode =
      body.fitMode === "width" ||
      body.fitMode === "height" ||
      body.fitMode === "original"
        ? body.fitMode
        : null;

    if (!seriesId || !readingDirection || !fitMode) {
      return badRequest("seriesId, readingDirection, and fitMode are required");
    }

    return NextResponse.json(
      await updateReaderPreferences({
        sourceSeriesId: seriesId,
        readingDirection,
        fitMode,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
