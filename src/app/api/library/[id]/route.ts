import { NextResponse } from "next/server";
import { z } from "zod";
import { getLibraryEntry, removeLibraryEntry, setLibraryEntryAdult } from "@/lib/library/state";
import { deleteAllSeriesDownloads } from "@/lib/offline/state";
import {
  assertTrustedWriteRequest,
  forbidden,
  handleApiError,
  notFound,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const updateAdultSchema = z.object({
  adult: z.boolean(),
  nsfwEnabled: z.boolean(),
});

function getRequestedSource(request: Request) {
  const source = new URL(request.url).searchParams.get("source")?.trim();
  return source || undefined;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const sourceName = getRequestedSource(request);
    const entry = getLibraryEntry(id, sourceName);

    if (!entry) {
      throw notFound("Library entry not found", { code: "library_entry_not_found" });
    }

    return NextResponse.json(entry);
  } catch (error) {
    return handleApiError("api.library.entry.failed", error, { sourceSeriesId: id });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const sourceName = getRequestedSource(request);
    assertTrustedWriteRequest(request);
    await deleteAllSeriesDownloads(id);
    removeLibraryEntry(id, sourceName);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError("api.library.remove.failed", error, { sourceSeriesId: id });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    assertTrustedWriteRequest(request);
    const body = await parseJsonBody(request, updateAdultSchema);
    if (!body.nsfwEnabled) {
      throw forbidden("NSFW mode must be enabled", { code: "nsfw_mode_required" });
    }
    const sourceName = getRequestedSource(request);
    return NextResponse.json(setLibraryEntryAdult(id, body.adult, sourceName));
  } catch (error) {
    return handleApiError("api.library.update.failed", error, { sourceSeriesId: id });
  }
}
