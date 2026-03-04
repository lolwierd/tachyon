import { NextResponse } from "next/server";
import {
    cleanupUnpinnedCache,
    deleteReadChapters,
    downloadChaptersBulk,
    getOfflineOverview,
    pinChapter,
    pinSeries,
    unpinChapter,
} from "@/lib/offline/state";
import type { DownloadScope } from "@/lib/offline/state";
import { logError } from "@/lib/server/log";

export const runtime = "nodejs";

function badRequest(message: string) {
    return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const seriesId = searchParams.get("seriesId") ?? undefined;
        return NextResponse.json(await getOfflineOverview(seriesId));
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logError("api.offline.get.failed", error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = (await request.json()) as {
            action?: string;
            seriesId?: string;
            chapterId?: string;
            maxAgeDays?: number;
            scope?: DownloadScope;
        };

        if (body.action === "pinChapter") {
            if (!body.seriesId || !body.chapterId) {
                return badRequest("seriesId and chapterId are required");
            }
            return NextResponse.json(await pinChapter(body.seriesId, body.chapterId));
        }

        if (body.action === "unpinChapter") {
            if (!body.seriesId || !body.chapterId) {
                return badRequest("seriesId and chapterId are required");
            }
            return NextResponse.json(await unpinChapter(body.seriesId, body.chapterId));
        }

        if (body.action === "pinSeries") {
            if (!body.seriesId) {
                return badRequest("seriesId is required");
            }
            return NextResponse.json(await pinSeries(body.seriesId));
        }

        if (body.action === "downloadBulk") {
            if (!body.seriesId) {
                return badRequest("seriesId is required");
            }
            const scope = body.scope ?? "all";
            const validScopes: DownloadScope[] = ["all", "unread", "next50", "next100"];
            if (!validScopes.includes(scope)) {
                return badRequest(`scope must be one of: ${validScopes.join(", ")}`);
            }
            return NextResponse.json(await downloadChaptersBulk(body.seriesId, scope));
        }

        if (body.action === "deleteReadChapters") {
            if (!body.seriesId) {
                return badRequest("seriesId is required");
            }
            return NextResponse.json(await deleteReadChapters(body.seriesId));
        }

        if (body.action === "cleanup") {
            return NextResponse.json(
                await cleanupUnpinnedCache(
                    typeof body.maxAgeDays === "number" ? body.maxAgeDays : 7,
                ),
            );
        }

        return badRequest("Unknown action");
    } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        logError("api.offline.post.failed", error);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
