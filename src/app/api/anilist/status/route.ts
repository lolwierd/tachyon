import { NextResponse } from "next/server";
import { disconnectAniListAccount, getAniListSyncOverview } from "@/lib/anilist/sync";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(getAniListSyncOverview());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.anilist.status.failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    disconnectAniListAccount();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.anilist.disconnect.failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
