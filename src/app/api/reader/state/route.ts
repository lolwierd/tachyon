import { NextResponse } from "next/server";
import { z } from "zod";
import {
  clearSeriesReadingProgress,
  getReaderState,
  saveReaderProgress,
  updateReaderPreferences,
} from "@/lib/reader/state";
import {
  assertTrustedWriteRequest,
  badRequest,
  handleApiError,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const readingDirectionSchema = z.enum(["vertical", "ltr", "rtl"]);
const fitModeSchema = z.enum(["width", "height", "original"]);

const saveProgressSchema = z.object({
  seriesId: z.string().trim().min(1),
  source: z.string().trim().min(1).optional(),
  chapterId: z.string().trim().min(1),
  pageCount: z.number().int().min(1).max(10000),
  currentPage: z.number().int().min(0).max(10000),
  chapterTitle: z.string().trim().min(1).optional(),
  chapterNo: z.number().nonnegative().optional(),
  completed: z.boolean().optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
});

const updatePreferencesSchema = z.object({
  seriesId: z.string().trim().min(1),
  source: z.string().trim().min(1).optional(),
  readingDirection: readingDirectionSchema,
  fitMode: fitModeSchema,
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const seriesId = searchParams.get("seriesId");
    const chapterId = searchParams.get("chapterId");
    const source = searchParams.get("source") ?? undefined;

    if (!seriesId || !chapterId) {
      throw badRequest("seriesId and chapterId are required");
    }

    return NextResponse.json(getReaderState(seriesId, chapterId, source));
  } catch (error) {
    return handleApiError("api.reader.state.get_failed", error, { url: request.url });
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    const body = await parseJsonBody(request, saveProgressSchema);

    const state = await saveReaderProgress({
      sourceSeriesId: body.seriesId,
      sourceName: body.source,
      sourceChapterId: body.chapterId,
      chapterTitle: body.chapterTitle,
      chapterNo: body.chapterNo,
      pageCount: body.pageCount,
      currentPage: body.currentPage,
      completed: body.completed,
      updatedAt: body.updatedAt,
    });

    return NextResponse.json(state);
  } catch (error) {
    return handleApiError("api.reader.state.post_failed", error, { url: request.url });
  }
}

export async function PATCH(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    const body = await parseJsonBody(request, updatePreferencesSchema);

    return NextResponse.json(
      await updateReaderPreferences({
        sourceSeriesId: body.seriesId,
        sourceName: body.source,
        readingDirection: body.readingDirection,
        fitMode: body.fitMode,
      }),
    );
  } catch (error) {
    return handleApiError("api.reader.state.patch_failed", error, { url: request.url });
  }
}

export async function DELETE(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    const { searchParams } = new URL(request.url);
    const seriesId = searchParams.get("seriesId");
    const source = searchParams.get("source") ?? undefined;

    if (!seriesId) {
      throw badRequest("seriesId is required");
    }

    return NextResponse.json({ ok: clearSeriesReadingProgress(seriesId, source) });
  } catch (error) {
    return handleApiError("api.reader.state.delete_failed", error, { url: request.url });
  }
}
