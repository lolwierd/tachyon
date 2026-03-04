import { NextRequest, NextResponse } from "next/server";
import { search } from "@/lib/sources/weebcentral";
import type { SearchOptions } from "@/lib/sources/types";
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

    const results = await search(q, options);
    return NextResponse.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.search.failed", error, {
      query: request.nextUrl.searchParams.get("q") ?? "",
      url: request.url,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
