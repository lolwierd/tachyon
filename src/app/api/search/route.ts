import { NextRequest, NextResponse } from "next/server";
import { getMainSources, getExtraSources } from "@/lib/sources/registry";
import "@/lib/sources/init";
import type { SearchOptions, SearchResult } from "@/lib/sources/types";
import { handleApiError } from "@/lib/server/api";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const q = params.get("q") ?? "";
    const nsfw = params.get("nsfw") === "1";
    const showExtra = params.get("showExtra") === "1";

    const options: SearchOptions = {};
    if (params.get("sort")) options.sort = params.get("sort") as SearchOptions["sort"];
    if (params.get("type")) options.type = [params.get("type") as "Manga" | "Manhwa" | "Manhua" | "OEL"];
    if (params.get("status")) options.status = [params.get("status") as "Ongoing" | "Complete" | "Hiatus" | "Canceled"];
    if (params.get("author")) options.author = params.get("author")!;

    const sources = showExtra
      ? [...getMainSources(nsfw), ...getExtraSources(nsfw)]
      : getMainSources(nsfw);

    const settled = await Promise.allSettled(
      sources.map(async (source) => {
        const results = await source.search(q, options);
        return results.map((r: SearchResult) => ({
          ...r,
          source: source.name,
        }));
      }),
    );

    const errors: string[] = [];
    const allResults = settled
      .map((r, i) => {
        if (r.status === "rejected") {
          const sourceName = sources[i]?.name ?? "unknown";
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          logError("api.search.source_failed", r.reason, { query: q, source: sourceName });
          errors.push(`${sourceName}: ${msg}`);
          return [];
        }
        return r.value;
      })
      .flat();

    return NextResponse.json({ results: allResults, errors });
  } catch (error) {
    return handleApiError("api.search.failed", error, {
      query: request.nextUrl.searchParams.get("q") ?? "",
      url: request.url,
    });
  }
}
