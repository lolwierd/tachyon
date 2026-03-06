import { NextResponse } from "next/server";
import { getLibraryEntry, removeLibraryEntry, setLibraryEntryAdult } from "@/lib/library/state";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

function getRequestedSource(request: Request) {
  const source = new URL(request.url).searchParams.get("source")?.trim();
  return source || undefined;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const sourceName = getRequestedSource(request);
    const entry = getLibraryEntry(id, sourceName);

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

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const sourceName = getRequestedSource(request);
    removeLibraryEntry(id, sourceName);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.library.remove.failed", error, { sourceSeriesId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const body = await request.json() as {
      adult?: unknown;
      nsfwEnabled?: unknown;
    };

    if (typeof body.adult !== "boolean") {
      return NextResponse.json({ error: "adult must be a boolean" }, { status: 400 });
    }

    if (body.nsfwEnabled !== true) {
      return NextResponse.json({ error: "NSFW mode must be enabled" }, { status: 403 });
    }

    const { id } = await context.params;
    const sourceName = getRequestedSource(request);
    return NextResponse.json(setLibraryEntryAdult(id, body.adult, sourceName));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const { id } = await context.params;
    logError("api.library.update.failed", error, { sourceSeriesId: id });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
