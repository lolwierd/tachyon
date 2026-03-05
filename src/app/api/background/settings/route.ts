import { NextResponse } from "next/server";
import {
  type BackgroundSettings,
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

    const patch: Partial<BackgroundSettings> = {};

    if (typeof body.downloadConcurrency === "number") {
      patch.downloadConcurrency = body.downloadConcurrency;
    }
    if (typeof body.downloadConcurrencyFallback === "number") {
      patch.downloadConcurrencyFallback = body.downloadConcurrencyFallback;
    }
    if (typeof body.nextNAfterRead === "number") {
      patch.nextNAfterRead = body.nextNAfterRead;
    }
    if (typeof body.autoDeleteReadEnabled === "boolean") {
      patch.autoDeleteReadEnabled = body.autoDeleteReadEnabled;
    }
    if (typeof body.autoDeleteKeepLastN === "number") {
      patch.autoDeleteKeepLastN = body.autoDeleteKeepLastN;
    }
    if (typeof body.defaultNewChapterLimit === "number") {
      patch.defaultNewChapterLimit = body.defaultNewChapterLimit;
    }
    if (typeof body.failureThreshold === "number") {
      patch.failureThreshold = body.failureThreshold;
    }
    if (typeof body.fallbackCooldownMinutes === "number") {
      patch.fallbackCooldownMinutes = body.fallbackCooldownMinutes;
    }
    if (typeof body.fallbackUntil === "string" || body.fallbackUntil === null) {
      patch.fallbackUntil = body.fallbackUntil;
    }

    const next = updateBackgroundSettings(patch);

    return NextResponse.json({ settings: next });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.background.settings.patch_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
