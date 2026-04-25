import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { activityEvent, chapterProgress, readingProgress } from "@/lib/db/schema";
import { assertTrustedWriteRequest, handleApiError } from "@/lib/server/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    const db = getDb();

    db.transaction((tx) => {
      tx.delete(chapterProgress).run();
      tx.delete(readingProgress).run();
      tx.delete(activityEvent).run();
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError("api.stats.reset.failed", error);
  }
}
