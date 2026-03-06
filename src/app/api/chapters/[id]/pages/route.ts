import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { chapter, sourceMapping } from "@/lib/db/schema";
import { getSeriesMapping, resolveSourceForSeries } from "@/lib/library/shared";
import { warmFlareSolverrHeaders } from "@/lib/media/flaresolverr";
import { getSource } from "@/lib/sources/registry";
import "@/lib/sources/init";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

function getSourceForChapter(sourceChapterId: string, sourceSeriesId: string, requestedSource?: string | null) {
  if (requestedSource) {
    return requestedSource;
  }

  const row = getDb()
    .select({ source: chapter.source })
    .from(chapter)
    .innerJoin(sourceMapping, eq(sourceMapping.seriesId, chapter.seriesId))
    .where(
      and(
        eq(chapter.sourceChapterId, sourceChapterId),
        or(
          eq(sourceMapping.sourceSeriesId, sourceSeriesId),
          eq(sourceMapping.seriesId, sourceSeriesId),
        ),
      ),
    )
    .get();
  return row?.source
    ?? getSeriesMapping(sourceSeriesId)?.source
    ?? resolveSourceForSeries(sourceSeriesId, requestedSource);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await context.params;
    const id = decodeURIComponent(rawId);
    const { searchParams } = new URL(request.url);
    const sourceSeriesId = searchParams.get("seriesId");
    const requestedSource = searchParams.get("source");
    if (!sourceSeriesId) {
      return NextResponse.json({ error: "Missing seriesId query parameter" }, { status: 400 });
    }
    const sourceName = getSourceForChapter(id, sourceSeriesId, requestedSource);
    if (!sourceName) {
      return NextResponse.json({ error: "Chapter source not found" }, { status: 404 });
    }

    const source = getSource(sourceName);
    if (!source) {
      return NextResponse.json({ error: `Unknown source: ${sourceName}` }, { status: 400 });
    }

    const pages = await source.getChapterPages(id);
    const referer = source.getChapterUrl?.(id) ?? `${source.baseUrl.replace(/\/$/, "")}/`;
    void warmFlareSolverrHeaders(sourceName, referer);

    const proxiedPages = pages.map((page) => ({
      ...page,
      imageUrl: `/api/media/page?url=${encodeURIComponent(page.imageUrl)}&source=${encodeURIComponent(sourceName)}&referer=${encodeURIComponent(referer)}`,
    }));

    return NextResponse.json(proxiedPages);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id: rawId } = await context.params;
    const id = decodeURIComponent(rawId);
    logError("api.chapter.pages.failed", error, { sourceChapterId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
