import { NextResponse } from "next/server";
import { detectNetworkPath } from "@/lib/network/path";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return NextResponse.json(detectNetworkPath(request.headers));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.network.path.get_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
