import { NextRequest, NextResponse } from "next/server";
import { getAniListConnectUrl } from "@/lib/anilist/sync";
import { handleApiError } from "@/lib/server/api";

export const runtime = "nodejs";

const OAUTH_STATE_COOKIE = "tachyon_anilist_oauth_state";

export async function GET(request: NextRequest) {
  try {
    const state = crypto.randomUUID();
    const response = NextResponse.redirect(getAniListConnectUrl(state));
    response.cookies.set({
      name: OAUTH_STATE_COOKIE,
      value: state,
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    return handleApiError("api.anilist.connect.failed", error);
  }
}
