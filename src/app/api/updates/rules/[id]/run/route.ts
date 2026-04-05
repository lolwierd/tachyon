import { NextResponse } from "next/server";
import { runUpdateRuleNow } from "@/lib/background/schedules";
import {
  assertTrustedWriteRequest,
  handleApiError,
  notFound,
} from "@/lib/server/api";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertTrustedWriteRequest(_request);
    const { id } = await context.params;
    const run = runUpdateRuleNow(id, "manual");
    if (!run) {
      throw notFound("Rule not found", { code: "update_rule_not_found" });
    }

    return NextResponse.json({ accepted: true, runId: run.id, run });
  } catch (error) {
    return handleApiError("api.updates.rules.run_failed", error);
  }
}
