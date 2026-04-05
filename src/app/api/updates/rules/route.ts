import { NextResponse } from "next/server";
import { z } from "zod";
import { createUpdateSchedule, listUpdateSchedules } from "@/lib/background/schedules";
import {
  assertTrustedWriteRequest,
  handleApiError,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const createRuleSchema = z.object({
  name: z.string().trim().min(1),
  enabled: z.boolean().optional(),
  targetType: z.enum(["all", "status_bucket", "smart_unread"]),
  targetValue: z.unknown().optional(),
  intervalMinutes: z.number().int().min(1).max(24 * 60),
  jitterSeconds: z.number().int().min(0).max(3600).optional(),
});

export async function GET() {
  try {
    return NextResponse.json({ rules: listUpdateSchedules() });
  } catch (error) {
    return handleApiError("api.updates.rules.get_failed", error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    const body = await parseJsonBody(request, createRuleSchema);

    const rule = createUpdateSchedule({
      name: body.name,
      enabled: body.enabled ?? true,
      targetType: body.targetType,
      targetValue: body.targetValue,
      intervalMinutes: body.intervalMinutes,
      jitterSeconds: body.jitterSeconds,
    });

    return NextResponse.json(rule);
  } catch (error) {
    return handleApiError("api.updates.rules.post_failed", error);
  }
}
