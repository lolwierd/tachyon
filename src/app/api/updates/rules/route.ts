import { NextResponse } from "next/server";
import { createUpdateSchedule, listUpdateSchedules } from "@/lib/background/schedules";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  try {
    return NextResponse.json({ rules: listUpdateSchedules() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.updates.rules.get_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      name?: string;
      enabled?: boolean;
      targetType?: "all" | "collection" | "status_bucket" | "smart_unread";
      targetValue?: unknown;
      intervalMinutes?: number;
      jitterSeconds?: number;
    };

    if (!body.name || !body.targetType || typeof body.intervalMinutes !== "number") {
      return badRequest("name, targetType, and intervalMinutes are required");
    }

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
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.updates.rules.post_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
