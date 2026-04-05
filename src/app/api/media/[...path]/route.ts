import { NextRequest, NextResponse } from "next/server";
import {
  buildUpstreamMediaHeaders,
  cacheRemotePage,
  isSafeRemoteMediaUrl,
  parseUpstreamReferer,
  streamCachedPage,
  UpstreamFetchError,
} from "@/lib/media/cache";
import { getDb } from "@/lib/db";
import { series, sourceMapping } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { logError, logInfo, logWarn } from "@/lib/server/log";
import { getSource } from "@/lib/sources/registry";
import "@/lib/sources/init";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getDbCoverUrl(seriesId: string): string | null {
  const row = getDb()
    .select({ coverUrl: series.coverUrl })
    .from(series)
    .where(eq(series.id, seriesId))
    .get();
  return row?.coverUrl ?? null;
}

function getSourceInfo(seriesId: string): { sourceSeriesId: string | null; source: string | null } {
  const row = getDb()
    .select({ sourceSeriesId: sourceMapping.sourceSeriesId, source: sourceMapping.source })
    .from(sourceMapping)
    .where(eq(sourceMapping.seriesId, seriesId))
    .get();
  return { sourceSeriesId: row?.sourceSeriesId ?? null, source: row?.source ?? null };
}

async function handleCover(id: string, forceRefresh: boolean): Promise<NextResponse> {
  // Try DB-stored cover URL first (works for all sources)
  const dbCoverUrl = getDbCoverUrl(id);
  const { sourceSeriesId, source } = getSourceInfo(id);
  const actualSourceId = sourceSeriesId ?? id;
  const upstreamUrl = dbCoverUrl && dbCoverUrl.startsWith("http")
    ? dbCoverUrl
    : `https://temp.compsci88.com/cover/fallback/${actualSourceId}.jpg`;

  let referer: string | undefined = undefined;
  if (source) {
    try {
      const sourceObj = getSource(source);
      if (sourceObj) {
        referer = sourceObj.baseUrl.endsWith("/") ? sourceObj.baseUrl : `${sourceObj.baseUrl}/`;
      }
    } catch {
      // Ignore if source not found
    }
  }

  // Fallback if not in DB but we can guess from URL
  if (!referer) {
    if (upstreamUrl.includes("omegascans")) referer = "https://omegascans.org/";
    else if (upstreamUrl.includes("madaradex")) referer = "https://madaradex.org/";
    else if (upstreamUrl.includes("toonily")) referer = "https://toonily.me/";
    else if (upstreamUrl.includes("hentai20")) referer = "https://hentai20.io/";
    else if (upstreamUrl.includes("manhwa18")) referer = "https://manhwa18.net/";
    else if (upstreamUrl.includes("oppai")) referer = "https://read.oppai.stream/";
  }

  try {
    const result = await cacheRemotePage(upstreamUrl, referer ? { Referer: referer } : undefined, {
      forceRefresh,
      sourceName: source ?? undefined,
      flareSolverrUrl: referer,
    });
    return new NextResponse(new Uint8Array(result.data), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "X-Cache": result.fromCache ? "HIT" : "MISS",
      },
    });
  } catch (error) {
    if (error instanceof UpstreamFetchError) {
      if (error.status === 400) {
        return NextResponse.json({ error: "URL not allowed" }, { status: 400 })
      }
      if (error.status === 404) {
        return NextResponse.json({ error: "Cover not found" }, { status: 404 })
      }
      if (error.status === 413) {
        return NextResponse.json({ error: "Upstream file too large" }, { status: 413 })
      }
      return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 })
    }
    throw error;
  }
}

async function handlePage(
  url: string | null,
  sourceName: string | null,
  requestedReferer: string | null,
): Promise<NextResponse> {
  if (!url) {
    logWarn("api.media.page.missing_url");
    return NextResponse.json(
      { error: "Missing url query parameter" },
      { status: 400 }
    )
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    logWarn("api.media.page.invalid_url", { url });
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (!isSafeRemoteMediaUrl(parsed)) {
    logWarn("api.media.page.url_blocked", { hostname: parsed.hostname.toLowerCase(), url });
    return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
  }

  const startMs = Date.now();

  // Fast path: stream directly from disk cache without buffering the whole file
  const cached = streamCachedPage(url);
  if (cached) {
    const elapsed = Date.now() - startMs;
    logInfo("api.media.page.serve", { url, elapsedMs: elapsed, sizeBytes: cached.size, cache: "HIT_STREAM" });
    return new NextResponse(cached.stream, {
      status: 200,
      headers: {
        "Content-Type": cached.contentType,
        "Content-Length": String(cached.size),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "X-Cache": "HIT",
      },
    });
  }

  logInfo("api.media.page.cache_miss", { url });

  try {
    const source = sourceName ? getSource(sourceName) : undefined;
    let referer: string;
    if (requestedReferer) {
      try {
        referer = parseUpstreamReferer(requestedReferer).toString();
      } catch {
        logWarn("api.media.page.invalid_referer", { referer: requestedReferer, url });
        return NextResponse.json({ error: "Invalid referer URL" }, { status: 400 });
      }
    } else {
      referer = source
        ? (source.baseUrl.endsWith("/") ? source.baseUrl : `${source.baseUrl}/`)
        : `${parsed.protocol}//${parsed.host}/`;
    }

    const result = await cacheRemotePage(url, {
      ...buildUpstreamMediaHeaders(referer, sourceName),
    }, {
      flareSolverrUrl: referer,
      sourceName: sourceName ?? undefined,
    });

    const elapsed = Date.now() - startMs;
    logInfo("api.media.page.fetched", { url, elapsedMs: elapsed, sizeBytes: result.data.byteLength, fromCache: result.fromCache });

    return new NextResponse(new Uint8Array(result.data), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "X-Cache": result.fromCache ? "HIT" : "MISS",
      },
    });
  } catch (error) {
    const elapsed = Date.now() - startMs;
    if (error instanceof UpstreamFetchError) {
      logWarn("api.media.page.upstream_failed", {
        url,
        status: error.status,
        statusText: error.message,
        elapsedMs: elapsed,
      });
      if (error.status === 400) {
        return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
      }
      if (error.status === 404) {
        return NextResponse.json({ error: "Image not found" }, { status: 404 });
      }
      if (error.status === 413) {
        return NextResponse.json({ error: "Upstream file too large" }, { status: 413 });
      }
      if (error.status === 401 || error.status === 403) {
        logWarn("api.media.page.redirecting_to_upstream", { url, status: error.status, elapsedMs: elapsed });
        return NextResponse.redirect(url, {
          status: 307,
          headers: {
            "Cache-Control": "no-store",
          },
        });
      }
      return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 });
    }

    throw error;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;

  if (!segments || segments.length === 0) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const type = segments[0];

  try {
    if (type === "cover") {
      const id = segments.slice(1).join("/");
      if (!id) {
        return NextResponse.json(
          { error: "Missing cover ID" },
          { status: 400 }
        )
      }
      const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true";
      return await handleCover(id, forceRefresh)
    }

    if (type === "page") {
      const url = request.nextUrl.searchParams.get("url");
      const sourceName = request.nextUrl.searchParams.get("source");
      const referer = request.nextUrl.searchParams.get("referer");
      return await handlePage(url, sourceName, referer)
    }

    return NextResponse.json({ error: "Unknown media type" }, { status: 400 })
  } catch (error) {
    logError("api.media.failed", error, {
      type,
      segments,
      url: request.nextUrl.searchParams.get("url"),
    })
    return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 })
  }
}
