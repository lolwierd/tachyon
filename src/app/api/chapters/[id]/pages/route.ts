import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { chapter, sourceMapping } from "@/lib/db/schema";
import { getSeriesMapping, resolveSourceForSeries } from "@/lib/library/shared";
import { warmFlareSolverrHeaders } from "@/lib/media/flaresolverr";
import { warmChapterPages } from "@/lib/media/cache";
import { getSource } from "@/lib/sources/registry";
import "@/lib/sources/init";
import { logError } from "@/lib/server/log";
import { getChapterPagesFromManifest } from "@/lib/offline/state";
import type { ChapterPage } from "@/lib/sources/types";

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

function proxyChapterPages(
  pages: ChapterPage[],
  sourceName: string,
  referer: string,
  sourceSeriesId: string,
  chapterId: string,
) {
  void warmFlareSolverrHeaders(sourceName, referer);
  void warmChapterPages(
    pages.map((page) => page.imageUrl),
    {
      chapterKey: `${sourceName}:${sourceSeriesId}:${chapterId}`,
      referer,
      sourceName,
    },
  );

  return pages.map((page) => ({
    ...page,
    imageUrl: `/api/media/page?url=${encodeURIComponent(page.imageUrl)}&source=${encodeURIComponent(sourceName)}&referer=${encodeURIComponent(referer)}`,
  }));
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

    const referer = source.getChapterUrl?.(id) ?? `${source.baseUrl.replace(/\/$/, "")}/`;

    // Serve from downloaded manifest if available — skips the network call to the source
    const manifestPages = await getChapterPagesFromManifest(sourceSeriesId, id, sourceName);
    if (manifestPages) {
      return NextResponse.json(
        proxyChapterPages(manifestPages, sourceName, referer, sourceSeriesId, id),
      );
    }

    const pages = await source.getChapterPages(id);
    return NextResponse.json(proxyChapterPages(pages, sourceName, referer, sourceSeriesId, id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id: rawId } = await context.params;
    const id = decodeURIComponent(rawId);
    logError("api.chapter.pages.failed", error, { sourceChapterId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
