import { NextRequest, NextResponse } from "next/server";
import { connectAniListAccount } from "@/lib/anilist/sync";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/library?anilist=missing-code", request.url));
  }

  try {
    await connectAniListAccount(code);
    return NextResponse.redirect(new URL("/library?anilist=connected", request.url));
  } catch (error) {
    logError("api.anilist.callback.failed", error);
    return NextResponse.redirect(new URL("/library?anilist=error", request.url));
  }
}
