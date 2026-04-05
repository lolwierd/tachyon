import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { chapter, sourceMapping } from "@/lib/db/schema";
import { getSeriesMapping, resolveSourceForSeries } from "@/lib/library/shared";
import { warmFlareSolverrHeaders } from "@/lib/media/flaresolverr";
import { warmChapterPages } from "@/lib/media/cache";
import { getSource } from "@/lib/sources/registry";
import "@/lib/sources/init";
import { getChapterPagesFromManifest } from "@/lib/offline/state";
import { badRequest, handleApiError, notFound } from "@/lib/server/api";
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
  const { id: rawId } = await context.params;
  const id = decodeURIComponent(rawId);
  const { searchParams } = new URL(request.url);
  const sourceSeriesId = searchParams.get("seriesId");
  const requestedSource = searchParams.get("source");

  try {
    if (!sourceSeriesId) {
      throw badRequest("Missing seriesId query parameter", { code: "missing_series_id" });
    }
    const sourceName = getSourceForChapter(id, sourceSeriesId, requestedSource);
    if (!sourceName) {
      throw notFound("Chapter source not found", { code: "chapter_source_not_found" });
    }

    const source = getSource(sourceName);
    if (!source) {
      throw badRequest(`Unknown source: ${sourceName}`, { code: "unknown_source" });
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
    return handleApiError("api.chapter.pages.failed", error, { sourceChapterId: id });
  }
}
