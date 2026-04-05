import { NextResponse, type NextRequest } from "next/server";
import {
  getBasicAuthConfig,
  matchesBasicAuth,
  requiresPublicAuth,
} from "@/lib/server/access";

function unauthorizedResponse() {
  return new NextResponse(
    "Authentication required",
    {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Tachyon"',
      },
    },
  );
}

export function middleware(request: NextRequest) {
  if (!requiresPublicAuth(request.headers)) {
    return NextResponse.next();
  }

  const authConfig = getBasicAuthConfig();
  if (!authConfig) {
    return NextResponse.next();
  }

  if (!matchesBasicAuth(request.headers, authConfig)) {
    return unauthorizedResponse();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|manifest.webmanifest|sw.js|workbox-.*\\.js|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|txt|xml)$).*)",
  ],
};
