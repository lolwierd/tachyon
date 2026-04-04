import { NextResponse } from "next/server";
import { getMemoryOverview } from "@/lib/memory/state";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const requestedLimit = Number(searchParams.get("limit") ?? "40");
        const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200) : 40;
        const includeNsfw = searchParams.get("nsfw") === "1";
        return NextResponse.json(getMemoryOverview(limit, { includeNsfw }));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logError("api.memory.overview.failed", error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
