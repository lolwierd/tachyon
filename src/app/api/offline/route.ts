import { NextResponse } from "next/server";
import { z } from "zod";
import {
    cleanupUnpinnedCache,
    getOfflineOverview,
    unpinChapter,
} from "@/lib/offline/state";
import {
    enqueueBulkDownload,
    enqueueDeleteReadDownloads,
    enqueueOptimizeCache,
    enqueueRefreshAllManifests,
    enqueueSingleChapterDownload,
} from "@/lib/background/enqueue";
import { getBackgroundSettings } from "@/lib/background/settings";
import {
    assertTrustedWriteRequest,
    handleApiError,
    parseJsonBody,
} from "@/lib/server/api";

export const runtime = "nodejs";

const downloadScopeSchema = z.enum(["all", "unread", "next5", "next10", "next50", "next100"]);
const sourceIdSchema = z.string().trim().min(1);

const offlineActionSchema = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("pinChapter"),
        seriesId: sourceIdSchema,
        chapterId: sourceIdSchema,
    }),
    z.object({
        action: z.literal("unpinChapter"),
        seriesId: sourceIdSchema,
        chapterId: sourceIdSchema,
    }),
    z.object({
        action: z.literal("pinSeries"),
        seriesId: sourceIdSchema,
    }),
    z.object({
        action: z.literal("downloadBulk"),
        seriesId: sourceIdSchema,
        scope: downloadScopeSchema.optional(),
    }),
    z.object({
        action: z.literal("deleteReadChapters"),
        seriesId: sourceIdSchema,
        keepLastN: z.number().int().min(0).max(200).optional(),
    }),
    z.object({
        action: z.literal("refreshManifests"),
    }),
    z.object({
        action: z.literal("cleanup"),
    }),
    z.object({
        action: z.literal("optimizeCache"),
    }),
]);

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const seriesId = searchParams.get("seriesId") ?? undefined;
        return NextResponse.json(await getOfflineOverview(seriesId));
    } catch (error) {
        return handleApiError("api.offline.get_failed", error, { url: request.url });
    }
}

export async function POST(request: Request) {
    try {
        assertTrustedWriteRequest(request);
        const body = await parseJsonBody(request, offlineActionSchema);

        if (body.action === "pinChapter") {
            const run = enqueueSingleChapterDownload({
                sourceSeriesId: body.seriesId,
                sourceChapterId: body.chapterId,
                trigger: "manual",
            });
            return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
        }

        if (body.action === "unpinChapter") {
            return NextResponse.json(await unpinChapter(body.seriesId, body.chapterId));
        }

        if (body.action === "pinSeries") {
            const run = await enqueueBulkDownload({
                sourceSeriesId: body.seriesId,
                scope: "all",
                trigger: "manual",
            });
            return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
        }

        if (body.action === "downloadBulk") {
            const scope = body.scope ?? "all";
            const run = await enqueueBulkDownload({
                sourceSeriesId: body.seriesId,
                scope,
                trigger: "manual",
            });
            return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
        }

        if (body.action === "deleteReadChapters") {
            const settings = getBackgroundSettings();
            const keepLastN = typeof body.keepLastN === "number"
                ? body.keepLastN
                : settings.autoDeleteKeepLastN;
            const run = enqueueDeleteReadDownloads({
                sourceSeriesId: body.seriesId,
                keepLastN,
                trigger: "manual",
                reason: "offline_action",
            });
            return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
        }

        if (body.action === "refreshManifests") {
            const count = enqueueRefreshAllManifests();
            return NextResponse.json({ accepted: true, count });
        }

        if (body.action === "cleanup") {
            return NextResponse.json(await cleanupUnpinnedCache());
        }

        if (body.action === "optimizeCache") {
            const run = enqueueOptimizeCache();
            return NextResponse.json({ accepted: true, runId: run?.id ?? null, run });
        }

        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    } catch (error) {
        return handleApiError("api.offline.post_failed", error, { url: request.url });
    }
}
