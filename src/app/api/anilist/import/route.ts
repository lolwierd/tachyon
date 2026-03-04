import { NextResponse } from "next/server";
import { importAniListLibrary } from "@/lib/anilist/sync";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await importAniListLibrary());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.anilist.import.failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
