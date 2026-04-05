import { NextResponse } from "next/server";
import { detectNetworkPath } from "@/lib/network/path";
import { handleApiError } from "@/lib/server/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    return NextResponse.json(detectNetworkPath(request.headers));
  } catch (error) {
    return handleApiError("api.network.path.get_failed", error);
  }
}
