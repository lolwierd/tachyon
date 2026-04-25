import { NextResponse } from "next/server";
import { isNsfwEnabled } from "@/lib/server/config";

export const runtime = "nodejs";
// The flag is resolved from env at request time (not build time) so the
// same image can be deployed in either mode by flipping NSFW_ENABLED at
// container startup.
export const dynamic = "force-dynamic";

// Public runtime config endpoint. Today the React app doesn't call this
// — the root layout resolves NSFW_ENABLED server-side and passes it
// through NsfwProvider props, which avoids a network roundtrip and any
// flash-of-wrong-state. This endpoint exists for:
//   * ops/debugging — `curl /api/config` to inspect a running container
//   * future non-React consumers (service worker precache decisions,
//     external health checks) that can't read props
// If it's still unused a few releases from now, delete it.
export function GET() {
  return NextResponse.json(
    { nsfwEnabled: isNsfwEnabled() },
    {
      status: 200,
      headers: {
        // Short client cache so a container restart with a flipped flag
        // becomes visible to PWAs within a minute without requiring a
        // hard reload. The value is cheap to recompute.
        "Cache-Control": "public, max-age=60, must-revalidate",
      },
    },
  );
}
