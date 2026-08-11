import { NextResponse } from "next/server";
import { z } from "zod";
import { listTagIdsForSeries, replaceSeriesTags } from "@/lib/library/tags";
import type { SeriesDetail } from "@/lib/sources/types";
import {
  assertTrustedWriteRequest,
  handleApiError,
  parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const seriesDetailSchema: z.ZodType<SeriesDetail> = z.object({
  sourceId: z.string().trim().min(1),
  source: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  coverUrl: z.string().trim().min(1),
  description: z.string(),
  authors: z.array(z.string()),
  tags: z.array(z.string()),
  type: z.string(),
  status: z.string(),
  year: z.number().nullable(),
  isAdult: z.boolean(),
  isOfficial: z.boolean(),
  anilistUrl: z.string().nullable(),
  relatedSeries: z.array(z.object({
    sourceId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    relationship: z.string().trim().min(1),
  })),
});

const replaceTagsSchema = z.object({
  tagIds: z.array(z.string().trim().min(1)).max(200),
  series: seriesDetailSchema.optional(),
});

function getRequestedSource(request: Request) {
  const source = new URL(request.url).searchParams.get("source")?.trim();
  return source || undefined;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    return NextResponse.json({ tagIds: listTagIdsForSeries(id, getRequestedSource(request)) });
  } catch (error) {
    return handleApiError("api.series.tags.list.failed", error, { sourceSeriesId: id });
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    assertTrustedWriteRequest(request);
    const body = await parseJsonBody(request, replaceTagsSchema);
    const sourceName = getRequestedSource(request) ?? body.series?.source;

    const nextTagIds = sourceName
      ? await replaceSeriesTags(id, body.tagIds, body.series, sourceName)
      : await replaceSeriesTags(id, body.tagIds, body.series);

    return NextResponse.json({ tagIds: nextTagIds });
  } catch (error) {
    return handleApiError("api.series.tags.replace.failed", error, { sourceSeriesId: id });
  }
}
