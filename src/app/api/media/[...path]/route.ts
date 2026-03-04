import { NextRequest, NextResponse } from "next/server";
import {
  cacheRemotePage,
  isAllowedPageDomain,
  UpstreamFetchError,
} from "@/lib/media/cache";
import { logError, logWarn } from "@/lib/server/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handleCover(id: string, forceRefresh: boolean): Promise<NextResponse> {
  const upstreamUrl = `https://temp.compsci88.com/cover/fallback/${id}.jpg`
  try {
    const result = await cacheRemotePage(upstreamUrl, undefined, { forceRefresh });
    return new NextResponse(new Uint8Array(result.data), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Cache": result.fromCache ? "HIT" : "MISS",
      },
    });
  } catch (error) {
    if (error instanceof UpstreamFetchError) {
      if (error.status === 404) {
        return NextResponse.json({ error: "Cover not found" }, { status: 404 })
      }
      return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 })
    }
    throw error;
  }
}

async function handlePage(url: string | null): Promise<NextResponse> {
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

  const hostname = parsed.hostname.toLowerCase();

  if (!isAllowedPageDomain(hostname)) {
    logWarn("api.media.page.domain_blocked", { hostname, url });
    return NextResponse.json({ error: "Domain not allowed" }, { status: 400 });
  }

  try {
    const result = await cacheRemotePage(url, {
      Referer: "https://weebcentral.com/",
    });

    return new NextResponse(new Uint8Array(result.data), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Cache": result.fromCache ? "HIT" : "MISS",
      },
    });
  } catch (error) {
    if (error instanceof UpstreamFetchError) {
      logWarn("api.media.page.upstream_failed", {
        url,
        status: error.status,
        statusText: error.message,
      });
      if (error.status === 404) {
        return NextResponse.json({ error: "Image not found" }, { status: 404 });
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
      return await handlePage(url)
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
