import { NextResponse } from "next/server";
import { getLibraryEntry } from "@/lib/library/state";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const entry = getLibraryEntry(id);

    if (!entry) {
      return NextResponse.json({ error: "Library entry not found" }, { status: 404 });
    }

    return NextResponse.json(entry);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.library.entry.failed", error, { sourceSeriesId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
