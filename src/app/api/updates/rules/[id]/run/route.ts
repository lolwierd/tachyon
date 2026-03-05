import { NextResponse } from "next/server";
import { runUpdateRuleNow } from "@/lib/background/schedules";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const run = runUpdateRuleNow(id, "manual");
    if (!run) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    return NextResponse.json({ accepted: true, runId: run.id, run });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.updates.rules.run_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
