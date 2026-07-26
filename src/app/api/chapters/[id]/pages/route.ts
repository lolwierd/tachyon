import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { chapter, sourceMapping } from "@/lib/db/schema";
import { getSeriesMapping, resolveSourceForSeries } from "@/lib/library/shared";
import { warmFlareSolverrHeaders } from "@/lib/media/flaresolverr";
import { getSource } from "@/lib/sources/registry";
import "@/lib/sources/init";
import { getChapterPagesFromManifest } from "@/lib/offline/state";
import { badRequest, handleApiError, notFound } from "@/lib/server/api";
import { logWarn } from "@/lib/server/log";
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
) {
  warmFlareSolverrHeaders(sourceName, referer).catch((err) =>
    logWarn("api.pages.flaresolverr_warm_failed", { error: String(err) }),
  );
  return pages.map((page) => ({
    ...page,
    imageUrl: `/api/media/page?url=${encodeURIComponent(page.imageUrl)}&source=${encodeURIComponent(sourceName)}&referer=${encodeURIComponent(referer)}`,
  }));
}

function chapterPagesResponse(pages: ChapterPage[], sourceName: string, referer: string) {
  return NextResponse.json(proxyChapterPages(pages, sourceName, referer), {
    headers: {
      // Page manifests are immutable enough for a short browser cache and
      // expensive enough (some sources take 2+ seconds) to be worth reusing.
      // `private` keeps source URLs out of shared/CDN caches.
      "Cache-Control": "private, max-age=300",
    },
  });
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
      return chapterPagesResponse(manifestPages, sourceName, referer);
    }

    const pages = await source.getChapterPages(id);
    return chapterPagesResponse(pages, sourceName, referer);
  } catch (error) {
    return handleApiError("api.chapter.pages.failed", error, { sourceChapterId: id });
  }
}
