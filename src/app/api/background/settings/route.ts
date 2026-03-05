import { NextResponse } from "next/server";
import {
  getBackgroundSettings,
  getDefaultBackgroundSettings,
  updateBackgroundSettings,
} from "@/lib/background/settings";
import { getLatestWorkerHeartbeat } from "@/lib/background/queue";
import { getWorkerRuntimeState } from "@/lib/background/worker";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({
      settings: getBackgroundSettings(),
      defaults: getDefaultBackgroundSettings(),
      workerHeartbeat: getLatestWorkerHeartbeat(),
      runtime: getWorkerRuntimeState(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.background.settings.get_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Partial<{
      downloadConcurrency: number;
      downloadConcurrencyFallback: number;
      nextNAfterRead: number;
      autoDeleteReadEnabled: boolean;
      autoDeleteKeepLastN: number;
      defaultNewChapterLimit: number;
      failureThreshold: number;
      fallbackCooldownMinutes: number;
      fallbackUntil: string | null;
    }>;

    const next = updateBackgroundSettings({
      downloadConcurrency: typeof body.downloadConcurrency === "number" ? body.downloadConcurrency : undefined,
      downloadConcurrencyFallback:
        typeof body.downloadConcurrencyFallback === "number" ? body.downloadConcurrencyFallback : undefined,
      nextNAfterRead: typeof body.nextNAfterRead === "number" ? body.nextNAfterRead : undefined,
      autoDeleteReadEnabled:
        typeof body.autoDeleteReadEnabled === "boolean" ? body.autoDeleteReadEnabled : undefined,
      autoDeleteKeepLastN:
        typeof body.autoDeleteKeepLastN === "number" ? body.autoDeleteKeepLastN : undefined,
      defaultNewChapterLimit:
        typeof body.defaultNewChapterLimit === "number" ? body.defaultNewChapterLimit : undefined,
      failureThreshold: typeof body.failureThreshold === "number" ? body.failureThreshold : undefined,
      fallbackCooldownMinutes:
        typeof body.fallbackCooldownMinutes === "number" ? body.fallbackCooldownMinutes : undefined,
      fallbackUntil:
        typeof body.fallbackUntil === "string" || body.fallbackUntil === null ? body.fallbackUntil : undefined,
    });

    return NextResponse.json({ settings: next });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.background.settings.patch_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
