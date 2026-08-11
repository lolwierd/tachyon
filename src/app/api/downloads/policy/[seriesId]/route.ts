import { NextResponse } from "next/server";
import { z } from "zod";
import { getSeriesPolicy, upsertSeriesPolicy } from "@/lib/background/enqueue";
import { getBackgroundSettings } from "@/lib/background/settings";
import {
  assertTrustedWriteRequest,
  handleApiError,
  notFound,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const updatePolicySchema = z.object({
  source: z.string().trim().min(1),
  autoDownloadNewEnabled: z.boolean(),
  autoDownloadNewLimit: z.number().int().min(1).max(50),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ seriesId: string }> },
) {
  try {
    const { seriesId } = await context.params;
    const source = new URL(request.url).searchParams.get("source") ?? undefined;
    const settings = getBackgroundSettings();
    const policy = getSeriesPolicy(seriesId, source);

    return NextResponse.json({
      sourceSeriesId: seriesId,
      autoDownloadNewEnabled: policy?.autoDownloadNewEnabled ?? false,
      autoDownloadNewLimit: policy?.autoDownloadNewLimit ?? settings.defaultNewChapterLimit,
    });
  } catch (error) {
    return handleApiError("api.downloads.policy.get_failed", error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ seriesId: string }> },
) {
  try {
    assertTrustedWriteRequest(request);
    const { seriesId } = await context.params;
    const body = await parseJsonBody(request, updatePolicySchema);

    const policy = upsertSeriesPolicy({
      sourceSeriesId: seriesId,
      sourceName: body.source,
      autoDownloadNewEnabled: body.autoDownloadNewEnabled,
      autoDownloadNewLimit: body.autoDownloadNewLimit,
    });

    if (!policy) {
      throw notFound("Series mapping not found", { code: "series_mapping_not_found" });
    }

    return NextResponse.json(policy);
  } catch (error) {
    return handleApiError("api.downloads.policy.put_failed", error);
  }
}
