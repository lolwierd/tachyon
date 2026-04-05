import { NextResponse } from "next/server";
import { z } from "zod";
import {
  type BackgroundSettings,
  getBackgroundSettings,
  getDefaultBackgroundSettings,
  updateBackgroundSettings,
} from "@/lib/background/settings";
import { getLatestWorkerHeartbeat } from "@/lib/background/queue";
import { getWorkerRuntimeState } from "@/lib/background/worker";
import {
  assertTrustedWriteRequest,
  handleApiError,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const settingsPatchSchema = z.object({
  downloadConcurrency: z.number().int().min(1).max(16).optional(),
  downloadConcurrencyFallback: z.number().int().min(1).max(16).optional(),
  nextNAfterRead: z.number().int().min(0).max(200).optional(),
  autoDeleteReadEnabled: z.boolean().optional(),
  autoDeleteKeepLastN: z.number().int().min(0).max(200).optional(),
  defaultNewChapterLimit: z.number().int().min(1).max(50).optional(),
  failureThreshold: z.number().int().min(1).max(100).optional(),
  fallbackCooldownMinutes: z.number().int().min(1).max(24 * 60).optional(),
  fallbackUntil: z.string().datetime({ offset: true }).nullable().optional(),
});

export async function GET() {
  try {
    return NextResponse.json({
      settings: getBackgroundSettings(),
      defaults: getDefaultBackgroundSettings(),
      workerHeartbeat: getLatestWorkerHeartbeat(),
      runtime: getWorkerRuntimeState(),
    });
  } catch (error) {
    return handleApiError("api.background.settings.get_failed", error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertTrustedWriteRequest(request);
    const body = await parseJsonBody(request, settingsPatchSchema);

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
    return handleApiError("api.background.settings.patch_failed", error);
  }
}
