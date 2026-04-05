import { NextRequest, NextResponse } from "next/server";
import { connectAniListAccount } from "@/lib/anilist/sync";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

const OAUTH_STATE_COOKIE = "tachyon_anilist_oauth_state";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  if (!code) {
    return NextResponse.redirect(new URL("/library?anilist=missing-code", request.url));
  }

  if (!state || !storedState || state !== storedState) {
    const response = NextResponse.redirect(new URL("/library?anilist=invalid-state", request.url));
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  }

  try {
    await connectAniListAccount(code);
    const response = NextResponse.redirect(new URL("/library?anilist=connected", request.url));
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    logError("api.anilist.callback.failed", error);
    const response = NextResponse.redirect(new URL("/library?anilist=error", request.url));
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  }
}
