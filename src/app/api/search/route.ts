import { NextRequest, NextResponse } from "next/server";
import { getAllSources, getSfwSources } from "@/lib/sources/registry";
import "@/lib/sources/init";
import type { SearchOptions, SearchResult } from "@/lib/sources/types";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const q = params.get("q") ?? "";

    const options: SearchOptions = {};
    if (params.get("sort")) options.sort = params.get("sort") as SearchOptions["sort"];
    if (params.get("type")) options.type = [params.get("type") as "Manga" | "Manhwa" | "Manhua" | "OEL"];
    if (params.get("status")) options.status = [params.get("status") as "Ongoing" | "Complete" | "Hiatus" | "Canceled"];
    if (params.get("author")) options.author = params.get("author")!;

    const sources = params.get("nsfw") === "1" ? getAllSources() : getSfwSources();

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

    return NextResponse.json(allResults);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.search.failed", error, {
      query: request.nextUrl.searchParams.get("q") ?? "",
      url: request.url,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
