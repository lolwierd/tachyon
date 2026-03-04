import { NextResponse } from "next/server";
import { getAniListConnectUrl } from "@/lib/anilist/sync";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.redirect(getAniListConnectUrl());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.anilist.connect.failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
