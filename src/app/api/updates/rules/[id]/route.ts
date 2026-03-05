import { NextResponse } from "next/server";
import { deleteUpdateSchedule, getUpdateSchedule, patchUpdateSchedule } from "@/lib/background/schedules";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

function badRequest(message: string) {
    return NextResponse.json({ error: message }, { status: 400 });
}

function notFound(message: string) {
    return NextResponse.json({ error: message }, { status: 404 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await request.json() as {
      name?: string;
      enabled?: boolean;
      targetType?: "all" | "collection" | "status_bucket" | "smart_unread";
      targetValue?: unknown;
      intervalMinutes?: number;
      jitterSeconds?: number;
    };

    const updated = patchUpdateSchedule(id, {
      name: body.name,
      enabled: body.enabled,
      targetType: body.targetType,
      targetValue: body.targetValue,
      intervalMinutes: body.intervalMinutes,
      jitterSeconds: body.jitterSeconds,
    });

    if (!updated) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.updates.rules.patch_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const existing = getUpdateSchedule(id);
    if (!existing) {
      return notFound("Rule not found");
    }

    deleteUpdateSchedule(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.updates.rules.delete_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
