import { NextResponse } from "next/server";
import { enqueueUpdateForLibrary } from "@/lib/background/enqueue";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function POST() {
  try {
    const run = enqueueUpdateForLibrary("library_refresh", "manual");
    return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.library.refresh.failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
