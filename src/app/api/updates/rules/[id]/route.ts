import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteUpdateSchedule, getUpdateSchedule, patchUpdateSchedule } from "@/lib/background/schedules";
import {
  assertTrustedWriteRequest,
  handleApiError,
  notFound,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const patchRuleSchema = z.object({
  name: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional(),
  targetType: z.enum(["all", "status_bucket", "smart_unread"]).optional(),
  targetValue: z.unknown().optional(),
  intervalMinutes: z.number().int().min(1).max(24 * 60).optional(),
  jitterSeconds: z.number().int().min(0).max(3600).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    assertTrustedWriteRequest(request);
    const body = await parseJsonBody(request, patchRuleSchema);

    const updated = patchUpdateSchedule(id, {
      name: body.name,
      enabled: body.enabled,
      targetType: body.targetType,
      targetValue: body.targetValue,
      intervalMinutes: body.intervalMinutes,
      jitterSeconds: body.jitterSeconds,
    });

    if (!updated) {
      throw notFound("Rule not found", { code: "update_rule_not_found" });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return handleApiError("api.updates.rules.patch_failed", error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertTrustedWriteRequest(_request);
    const { id } = await context.params;
    const existing = getUpdateSchedule(id);
    if (!existing) {
      throw notFound("Rule not found", { code: "update_rule_not_found" });
    }

    deleteUpdateSchedule(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleApiError("api.updates.rules.delete_failed", error);
  }
}
