import { NextResponse } from "next/server";
import { getSeriesPolicy, upsertSeriesPolicy } from "@/lib/background/enqueue";
import { getBackgroundSettings } from "@/lib/background/settings";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ seriesId: string }> },
) {
  try {
    const { seriesId } = await context.params;
    const settings = getBackgroundSettings();
    const policy = getSeriesPolicy(seriesId);

    return NextResponse.json({
      sourceSeriesId: seriesId,
      autoDownloadNewEnabled: policy?.autoDownloadNewEnabled ?? false,
      autoDownloadNewLimit: policy?.autoDownloadNewLimit ?? settings.defaultNewChapterLimit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.downloads.policy.get_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ seriesId: string }> },
) {
  try {
    const { seriesId } = await context.params;
    const body = await request.json() as {
      autoDownloadNewEnabled?: boolean;
      autoDownloadNewLimit?: number;
    };

    if (typeof body.autoDownloadNewEnabled !== "boolean") {
      return NextResponse.json({ error: "autoDownloadNewEnabled is required" }, { status: 400 });
    }

    if (typeof body.autoDownloadNewLimit !== "number") {
      return NextResponse.json({ error: "autoDownloadNewLimit is required" }, { status: 400 });
    }

    const policy = upsertSeriesPolicy({
      sourceSeriesId: seriesId,
      autoDownloadNewEnabled: body.autoDownloadNewEnabled,
      autoDownloadNewLimit: body.autoDownloadNewLimit,
    });

    if (!policy) {
      return NextResponse.json({ error: "Series mapping not found" }, { status: 404 });
    }

    return NextResponse.json(policy);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logError("api.downloads.policy.put_failed", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
