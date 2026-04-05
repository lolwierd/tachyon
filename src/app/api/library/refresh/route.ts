import { NextResponse } from "next/server";
import { enqueueUpdateForLibrary } from "@/lib/background/enqueue";
import {
  assertTrustedWriteRequest,
  handleApiError,
} from "@/lib/server/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    const run = enqueueUpdateForLibrary("library_refresh", "manual");
    return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
  } catch (error) {
    return handleApiError("api.library.refresh.failed", error);
  }
}
