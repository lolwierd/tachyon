import { NextResponse } from "next/server";
import { disconnectAniListAccount, getAniListSyncOverview } from "@/lib/anilist/sync";
import {
  assertTrustedWriteRequest,
  handleApiError,
} from "@/lib/server/api";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(getAniListSyncOverview());
  } catch (error) {
    return handleApiError("api.anilist.status.failed", error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    disconnectAniListAccount();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError("api.anilist.disconnect.failed", error);
  }
}
