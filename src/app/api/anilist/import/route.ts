import { NextResponse } from "next/server";
import { importAniListLibrary } from "@/lib/anilist/sync";
import {
  assertTrustedWriteRequest,
  handleApiError,
} from "@/lib/server/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    return NextResponse.json(await importAniListLibrary());
  } catch (error) {
    return handleApiError("api.anilist.import.failed", error);
  }
}
