import { NextResponse } from "next/server";
import { isNsfwEnabled } from "@/lib/server/config";

export const runtime = "nodejs";
// The flag is resolved from env at request time (not build time) so the
// same image can be deployed in either mode by flipping NSFW_ENABLED at
// container startup.
export const dynamic = "force-dynamic";

// Public runtime config for the client. Today this only carries the
// NSFW kill switch — the root layout passes it through props so the
// client never sees a mismatched initial render, but service workers
// and other non-React consumers can read it here.
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
