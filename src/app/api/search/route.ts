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

    // Allowlist each enum param so an attacker (or a stale bookmarked URL)
    // can't push arbitrary strings through to downstream scrapers. Author
    // is free-form by design but capped to keep unreasonably long values
    // from ballooning request URLs.
    const SORTS: ReadonlyArray<NonNullable<SearchOptions["sort"]>> = [
      "Popularity",
      "Latest Updates",
      "Recently Added",
      "Alphabet",
    ];
    const TYPES = ["Manga", "Manhwa", "Manhua", "OEL"] as const;
    const STATUSES = ["Ongoing", "Complete", "Hiatus", "Canceled"] as const;

    const options: SearchOptions = {};
    const sortParam = params.get("sort");
    if (sortParam && (SORTS as readonly string[]).includes(sortParam)) {
      options.sort = sortParam as SearchOptions["sort"];
    }
    const typeParam = params.get("type");
    if (typeParam && (TYPES as readonly string[]).includes(typeParam)) {
      options.type = [typeParam as (typeof TYPES)[number]];
    }
    const statusParam = params.get("status");
    if (statusParam && (STATUSES as readonly string[]).includes(statusParam)) {
      options.status = [statusParam as (typeof STATUSES)[number]];
    }
    const authorParam = params.get("author");
    if (authorParam) options.author = authorParam.slice(0, 200);

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
