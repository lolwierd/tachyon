import { NextResponse, type NextRequest } from "next/server";
import {
  BASIC_AUTH_PASSWORD_ENV,
  BASIC_AUTH_USERNAME_ENV,
  getBasicAuthConfig,
  matchesBasicAuth,
  requiresPublicAuth,
} from "@/lib/server/access";

function unauthorizedResponse(configured: boolean) {
  return new NextResponse(
    configured
      ? "Authentication required"
      : `Public access requires ${BASIC_AUTH_USERNAME_ENV} and ${BASIC_AUTH_PASSWORD_ENV} to be configured.`,
    {
      status: configured ? 401 : 503,
      headers: {
        "Cache-Control": "no-store",
        ...(configured ? { "WWW-Authenticate": 'Basic realm="Tachyon"' } : {}),
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
    return unauthorizedResponse(false);
  }

  if (!matchesBasicAuth(request.headers, authConfig)) {
    return unauthorizedResponse(true);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|manifest.webmanifest|sw.js|workbox-.*\\.js|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|txt|xml)$).*)",
  ],
};
