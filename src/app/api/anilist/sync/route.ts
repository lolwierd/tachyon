import { NextResponse } from "next/server";
import { syncAniListLibrary } from "@/lib/anilist/sync";
import {
  assertTrustedWriteRequest,
  handleApiError,
} from "@/lib/server/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    return NextResponse.json(await syncAniListLibrary());
  } catch (error) {
    return handleApiError("api.anilist.sync.failed", error);
  }
}
