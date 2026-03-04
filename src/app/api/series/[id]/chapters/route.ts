import { NextResponse } from "next/server";
import { getChapterList } from "@/lib/sources/weebcentral";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const chapters = await getChapterList(id);
    return NextResponse.json(chapters);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.series.chapters.failed", error, { sourceId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
