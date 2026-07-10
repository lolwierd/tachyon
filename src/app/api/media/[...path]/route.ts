import { NextRequest, NextResponse } from "next/server";
import {
  buildUpstreamMediaHeaders,
  cacheRemotePage,
  isSafeRemoteMediaUrl,
  type MediaOptimization,
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

// Hostname → referer backstop for CDNs whose image host differs from the
// expected referer origin (e.g. media.omegascans.org serves images but the
// CDN validates referer against omegascans.org). Only consulted when the
// registered-source lookup fails — stale DB rows, NSFW scrapers dropped by
// the kill switch, orphaned `source` column.
const REFERER_HOSTNAME_MAP: Record<string, string> = {
  "omegascans.org": "https://omegascans.org/",
  "media.omegascans.org": "https://omegascans.org/",
  "madaradex.org": "https://madaradex.org/",
  "cdn.madaradex.org": "https://madaradex.org/",
  "toonily.me": "https://toonily.me/",
  "hentai20.io": "https://hentai20.io/",
  "manhwa18.net": "https://manhwa18.net/",
  "min.manhwa18.net": "https://manhwa18.net/",
  "read.oppai.stream": "https://read.oppai.stream/",
};

function getDbCoverInfo(seriesId: string): { coverUrl: string | null; anilistId: number | null } {
  const row = getDb()
    .select({ coverUrl: series.coverUrl, anilistId: series.anilistId })
    .from(series)
    .where(eq(series.id, seriesId))
    .get();
  return {
    coverUrl: row?.coverUrl ?? null,
    anilistId: row?.anilistId ?? null,
  };
}

async function getAniListCoverUrl(anilistId: number): Promise<string | null> {
  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: `
          query Cover($id: Int!) {
            Media(id: $id, type: MANGA) {
              coverImage { extraLarge large medium }
            }
          }
        `,
        variables: { id: anilistId },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;

    const payload = await response.json() as {
      data?: { Media?: { coverImage?: { extraLarge?: string; large?: string; medium?: string } } };
    };
    const cover = payload.data?.Media?.coverImage;
    return cover?.extraLarge ?? cover?.large ?? cover?.medium ?? null;
  } catch {
    return null;
  }
}

async function resolveAniListId(
  seriesId: string,
  existingId: number | null,
  source: string | null,
  sourceSeriesId: string,
): Promise<number | null> {
  if (existingId) return existingId;
  if (!source) return null;

  try {
    const sourceObj = getSource(source);
    if (!sourceObj) return null;
    const detail = await sourceObj.getSeriesDetail(sourceSeriesId);
    const match = detail.anilistUrl?.match(/anilist\.co\/manga\/(\d+)/i);
    if (!match) return null;

    const resolvedId = Number(match[1]);
    if (!Number.isSafeInteger(resolvedId)) return null;
    getDb()
      .update(series)
      .set({ anilistId: resolvedId, updatedAt: new Date() })
      .where(eq(series.id, seriesId))
      .run();
    return resolvedId;
  } catch (error) {
    logWarn("api.media.cover.anilist_id_resolution_failed", {
      seriesId,
      source,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function coverResponse(result: Awaited<ReturnType<typeof cacheRemotePage>>) {
  return new NextResponse(new Uint8Array(result.data), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Length": String(result.data.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "X-Cache": result.fromCache ? "HIT" : "MISS",
    },
  });
}

async function tryAniListCover(input: {
  seriesId: string;
  anilistId: number | null;
  source: string | null;
  sourceSeriesId: string;
  failedUrl: string;
  forceRefresh: boolean;
}): Promise<NextResponse | null> {
  const anilistId = await resolveAniListId(
    input.seriesId,
    input.anilistId,
    input.source,
    input.sourceSeriesId,
  );
  if (!anilistId) return null;

  const fallbackUrl = await getAniListCoverUrl(anilistId);
  if (!fallbackUrl) return null;

  try {
    const result = await cacheRemotePage(fallbackUrl, { Referer: "https://anilist.co/" }, {
      forceRefresh: input.forceRefresh,
      optimization: "cover",
    });
    logWarn("api.media.cover.upstream_fallback", {
      seriesId: input.seriesId,
      failedUrl: input.failedUrl,
      fallback: "anilist",
    });
    return coverResponse(result);
  } catch (error) {
    logWarn("api.media.cover.fallback_failed", {
      seriesId: input.seriesId,
      fallback: "anilist",
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
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
  const { coverUrl: dbCoverUrl, anilistId } = getDbCoverInfo(id);
  const { sourceSeriesId, source } = getSourceInfo(id);
  const actualSourceId = sourceSeriesId ?? id;
  const upstreamUrl = dbCoverUrl && dbCoverUrl.startsWith("http")
    ? dbCoverUrl
    : `https://temp.compsci88.com/cover/fallback/${actualSourceId}.jpg`;

  // Referer resolution is layered:
  //   1. Registered source (authoritative) — covers every scraper we ship.
  //   2. Hostname backstop — for CDNs whose image host (media.omegascans.org)
  //      differs from the expected referer origin (omegascans.org). Used
  //      when the DB row has no `source` or when the source isn't
  //      registered this run (e.g. NSFW kill switch disables the scraper
  //      but old cover URLs still exist in the DB).
  //   3. Origin-only — last resort. An `<img>` in a browser would actually
  //      send the page origin, so some CDNs reject this. Only reached for
  //      upstreams that aren't in layers 1 or 2.
  let referer: string | undefined;
  if (source) {
    try {
      const sourceObj = getSource(source);
      if (sourceObj) {
        referer = sourceObj.baseUrl.endsWith("/") ? sourceObj.baseUrl : `${sourceObj.baseUrl}/`;
      }
    } catch {
      // Source not registered — fall through.
    }
  }
  if (!referer) {
    try {
      const hostname = new URL(upstreamUrl).hostname.toLowerCase();
      referer = REFERER_HOSTNAME_MAP[hostname];
      if (!referer) {
        const parts = hostname.split(".");
        const parent = parts.length > 2 ? parts.slice(-2).join(".") : null;
        if (parent) referer = REFERER_HOSTNAME_MAP[parent];
      }
      if (!referer) {
        const parsed = new URL(upstreamUrl);
        referer = `${parsed.protocol}//${parsed.host}/`;
      }
    } catch {
      // Invalid URL — leave undefined; cacheRemotePage handles no-referer.
    }
  }

  let knownDeadUpstream = false;
  try {
    knownDeadUpstream = new URL(upstreamUrl).hostname.toLowerCase() === "temp.compsci88.com";
  } catch {
    // cacheRemotePage will return the existing invalid-URL response below.
  }
  if (knownDeadUpstream) {
    const fallback = await tryAniListCover({
      seriesId: id,
      anilistId,
      source,
      sourceSeriesId: actualSourceId,
      failedUrl: upstreamUrl,
      forceRefresh,
    });
    if (fallback) return fallback;
  }

  try {
    const result = await cacheRemotePage(upstreamUrl, referer ? { Referer: referer } : undefined, {
      forceRefresh,
      optimization: "cover",
      sourceName: source ?? undefined,
      flareSolverrUrl: referer,
    });
    return coverResponse(result);
  } catch (error) {
    if (!knownDeadUpstream) {
      const fallback = await tryAniListCover({
        seriesId: id,
        anilistId,
        source,
        sourceSeriesId: actualSourceId,
        failedUrl: upstreamUrl,
        forceRefresh,
      });
      if (fallback) return fallback;
    }

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
  optimization: MediaOptimization,
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
  const cached = streamCachedPage(url, optimization);
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
      optimization,
      sourceName: sourceName ?? undefined,
    });

    const elapsed = Date.now() - startMs;
    logInfo("api.media.page.fetched", { url, elapsedMs: elapsed, sizeBytes: result.data.byteLength, fromCache: result.fromCache });

    return new NextResponse(new Uint8Array(result.data), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Length": String(result.data.byteLength),
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
        // Previously we 307-redirected the browser to the raw `?url=` param
        // so it could retry directly, but that's an open redirect: an
        // authenticated user (or anyone who landed on a page that embeds
        // the URL) can coerce our server into bouncing them to any
        // arbitrary host. Treat upstream auth failures as a plain 502.
        logWarn("api.media.page.upstream_auth_error", { url, status: error.status, elapsedMs: elapsed });
        return NextResponse.json({ error: "Upstream refused the request" }, { status: 502 });
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
      const optimization = request.nextUrl.searchParams.get("kind") === "cover"
        ? "cover"
        : "page";
      return await handlePage(url, sourceName, referer, optimization)
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
