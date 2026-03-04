import { NextResponse } from "next/server";
import { getMemoryOverview } from "@/lib/memory/state";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const requestedLimit = Number(searchParams.get("limit") ?? "40");
        const limit = Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 40;
        return NextResponse.json(getMemoryOverview(limit));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logError("api.memory.overview.failed", error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
