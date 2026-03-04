import { and, eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { chapter, chapterProgress, mediaCache, sourceMapping } from "@/lib/db/schema";
import {
    cacheRemotePage,
    CACHE_DIR,
    ensurePinManifestDir,
    PIN_MANIFEST_DIR,
} from "@/lib/media/cache";
import { ensureSeriesRecord, SOURCE } from "@/lib/library/shared";
import { getChapterList, getChapterPages } from "@/lib/sources/weebcentral";
import type { Chapter } from "@/lib/sources/types";

interface PinManifest {
    sourceSeriesId: string;
    sourceChapterId: string;
    files: string[];
    generatedAt: string;
}

export interface OfflineChapterRecord {
    sourceSeriesId: string;
    sourceChapterId: string;
    chapterNo: number;
    title: string;
    state: "missing" | "partial" | "ready";
    bytes: number;
    cachedAt: string | null;
    pinned: boolean;
}

export interface OfflineOverview {
    storage: {
        cacheBytes: number;
        cachedFiles: number;
        pinnedBytes: number;
        pinnedChapters: number;
    };
    chapters: OfflineChapterRecord[];
}

export interface PinChapterResult {
    sourceSeriesId: string;
    sourceChapterId: string;
    pageCount: number;
    bytes: number;
    state: "missing" | "partial" | "ready";
}

function toIsoString(value: Date | null | undefined) {
    return value ? value.toISOString() : null;
}

function safeManifestName(sourceSeriesId: string, sourceChapterId: string) {
    const safeSeries = encodeURIComponent(sourceSeriesId);
    const safeChapter = encodeURIComponent(sourceChapterId);
    return `${safeSeries}__${safeChapter}.json`;
}

async function listFilesRecursive(dirPath: string): Promise<string[]> {
    if (!existsSync(dirPath)) {
        return [];
    }

    const entries = await readdir(dirPath, { withFileTypes: true });
    const files = await Promise.all(
        entries.map(async (entry) => {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                return listFilesRecursive(fullPath);
            }
            return [fullPath];
        }),
    );

    return files.flat();
}

async function directoryStats(dirPath: string) {
    const files = await listFilesRecursive(dirPath);
    let bytes = 0;

    for (const filePath of files) {
        const fileStat = await stat(filePath);
        bytes += fileStat.size;
    }

    return {
        files: files.length,
        bytes,
    };
}

async function readManifest(manifestPath: string): Promise<PinManifest | null> {
    if (!existsSync(manifestPath)) {
        return null;
    }

    try {
        const raw = await readFile(manifestPath, "utf8");
        const parsed = JSON.parse(raw) as PinManifest;
        if (!Array.isArray(parsed.files)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

async function loadPinnedReferences(excludeManifestPath?: string) {
    const manifestRows = getDb()
        .select({ path: mediaCache.path })
        .from(mediaCache)
        .where(eq(mediaCache.state, "ready"))
        .all()
        .map((row) => row.path)
        .filter((value): value is string => Boolean(value));

    const pinnedFiles = new Set<string>();
    const pinnedManifestPaths = new Set<string>();

    for (const manifestPath of manifestRows) {
        if (excludeManifestPath && manifestPath === excludeManifestPath) {
            continue;
        }

        if (!existsSync(manifestPath)) {
            continue;
        }

        pinnedManifestPaths.add(manifestPath);
        const manifest = await readManifest(manifestPath);
        if (!manifest) {
            continue;
        }

        for (const filePath of manifest.files) {
            pinnedFiles.add(filePath);
        }
    }

    return { pinnedFiles, pinnedManifestPaths };
}

async function ensureChapterRecord(
    seriesId: string,
    sourceSeriesId: string,
    sourceChapterId: string,
    chapterMeta?: Pick<Chapter, "sourceChapterId" | "chapterNo" | "title">,
) {
    const existing = getDb()
        .select({
            id: chapter.id,
            chapterNo: chapter.chapterNo,
            title: chapter.title,
        })
        .from(chapter)
        .where(
            and(
                eq(chapter.seriesId, seriesId),
                eq(chapter.source, SOURCE),
                eq(chapter.sourceChapterId, sourceChapterId),
            ),
        )
        .get();

    if (existing) {
        return {
            chapterId: existing.id,
            chapterNo: existing.chapterNo,
            title: existing.title ?? `Chapter ${existing.chapterNo}`,
        };
    }

    let nextMeta = chapterMeta;
    if (!nextMeta) {
        const chapterList = await getChapterList(sourceSeriesId);
        nextMeta = chapterList.find((item) => item.sourceChapterId === sourceChapterId);
    }

    const chapterId = crypto.randomUUID();
    const chapterNo = nextMeta?.chapterNo ?? 0;
    const title = nextMeta?.title ?? `Chapter ${chapterNo || "?"}`;

    getDb().insert(chapter).values({
        id: chapterId,
        seriesId,
        source: SOURCE,
        sourceChapterId,
        chapterNo,
        title,
        pageCount: 0,
        sortKey: chapterNo,
        createdAt: new Date(),
    }).run();

    return {
        chapterId,
        chapterNo,
        title,
    };
}

export async function getOfflineOverview(sourceSeriesId?: string): Promise<OfflineOverview> {
    const rows = sourceSeriesId
        ? getDb()
            .select({
                sourceSeriesId: sourceMapping.sourceSeriesId,
                sourceChapterId: chapter.sourceChapterId,
                chapterNo: chapter.chapterNo,
                title: chapter.title,
                state: mediaCache.state,
                bytes: mediaCache.bytes,
                cachedAt: mediaCache.cachedAt,
                path: mediaCache.path,
            })
            .from(mediaCache)
            .innerJoin(chapter, eq(mediaCache.chapterId, chapter.id))
            .innerJoin(
                sourceMapping,
                and(eq(sourceMapping.seriesId, chapter.seriesId), eq(sourceMapping.source, SOURCE)),
            )
            .where(eq(sourceMapping.sourceSeriesId, sourceSeriesId))
            .all()
        : getDb()
            .select({
                sourceSeriesId: sourceMapping.sourceSeriesId,
                sourceChapterId: chapter.sourceChapterId,
                chapterNo: chapter.chapterNo,
                title: chapter.title,
                state: mediaCache.state,
                bytes: mediaCache.bytes,
                cachedAt: mediaCache.cachedAt,
                path: mediaCache.path,
            })
            .from(mediaCache)
            .innerJoin(chapter, eq(mediaCache.chapterId, chapter.id))
            .innerJoin(
                sourceMapping,
                and(eq(sourceMapping.seriesId, chapter.seriesId), eq(sourceMapping.source, SOURCE)),
            )
            .all();

    const stats = await directoryStats(CACHE_DIR);
    const chapters = rows
        .map((row) => ({
            sourceSeriesId: row.sourceSeriesId,
            sourceChapterId: row.sourceChapterId,
            chapterNo: row.chapterNo,
            title: row.title ?? `Chapter ${row.chapterNo}`,
            state: row.state,
            bytes: row.bytes ?? 0,
            cachedAt: toIsoString(row.cachedAt),
            pinned: row.state === "ready" && Boolean(row.path),
        }))
        .sort((left, right) => right.chapterNo - left.chapterNo);

    return {
        storage: {
            cacheBytes: stats.bytes,
            cachedFiles: stats.files,
            pinnedBytes: chapters.reduce((sum, chapterItem) => sum + chapterItem.bytes, 0),
            pinnedChapters: chapters.filter((chapterItem) => chapterItem.pinned).length,
        },
        chapters,
    };
}

export async function pinChapter(
    sourceSeriesId: string,
    sourceChapterId: string,
    chapterMeta?: Pick<Chapter, "sourceChapterId" | "chapterNo" | "title">,
): Promise<PinChapterResult> {
    const localSeriesId = await ensureSeriesRecord(sourceSeriesId);
    const localChapter = await ensureChapterRecord(
        localSeriesId,
        sourceSeriesId,
        sourceChapterId,
        chapterMeta,
    );

    const pages = await getChapterPages(sourceChapterId);
    ensurePinManifestDir();

    const files = new Set<string>();
    let bytes = 0;

    for (const page of pages) {
        const result = await cacheRemotePage(page.imageUrl, {
            Referer: "https://weebcentral.com/",
        });
        files.add(result.cachePath);
        bytes += result.data.byteLength;
    }

    const manifestPath = path.join(
        PIN_MANIFEST_DIR,
        safeManifestName(sourceSeriesId, sourceChapterId),
    );

    await writeFile(
        manifestPath,
        JSON.stringify(
            {
                sourceSeriesId,
                sourceChapterId,
                files: [...files],
                generatedAt: new Date().toISOString(),
            } satisfies PinManifest,
            null,
            2,
        ),
    );

    getDb().insert(mediaCache).values({
        chapterId: localChapter.chapterId,
        state: pages.length === files.size ? "ready" : "partial",
        bytes,
        cachedAt: new Date(),
        path: manifestPath,
    }).onConflictDoUpdate({
        target: mediaCache.chapterId,
        set: {
            state: pages.length === files.size ? "ready" : "partial",
            bytes,
            cachedAt: new Date(),
            path: manifestPath,
        },
    }).run();

    return {
        sourceSeriesId,
        sourceChapterId,
        pageCount: pages.length,
        bytes,
        state: pages.length === files.size ? "ready" : "partial",
    };
}

export async function pinSeries(sourceSeriesId: string) {
    const chapterList = await getChapterList(sourceSeriesId);
    const failures: Array<{ chapterId: string; error: string }> = [];
    let pinned = 0;

    for (const chapterItem of chapterList) {
        try {
            await pinChapter(sourceSeriesId, chapterItem.sourceChapterId, chapterItem);
            pinned += 1;
        } catch (error) {
            failures.push({
                chapterId: chapterItem.sourceChapterId,
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }

    return {
        sourceSeriesId,
        requested: chapterList.length,
        pinned,
        failures,
    };
}

export async function unpinChapter(sourceSeriesId: string, sourceChapterId: string) {
    const row = getDb().select({
        chapterId: chapter.id,
        manifestPath: mediaCache.path,
    })
        .from(chapter)
        .innerJoin(
            sourceMapping,
            and(eq(sourceMapping.seriesId, chapter.seriesId), eq(sourceMapping.source, SOURCE)),
        )
        .leftJoin(mediaCache, eq(mediaCache.chapterId, chapter.id))
        .where(
            and(
                eq(sourceMapping.sourceSeriesId, sourceSeriesId),
                eq(chapter.sourceChapterId, sourceChapterId),
            ),
        )
        .get();

    if (!row) {
        return { sourceSeriesId, sourceChapterId, removedFiles: 0 };
    }

    const manifestPath = row.manifestPath;
    let removedFiles = 0;

    if (manifestPath && existsSync(manifestPath)) {
        const manifest = await readManifest(manifestPath);
        const references = await loadPinnedReferences(manifestPath);

        if (manifest) {
            for (const filePath of manifest.files) {
                if (references.pinnedFiles.has(filePath)) {
                    continue;
                }

                if (existsSync(filePath)) {
                    await rm(filePath, { force: true });
                    removedFiles += 1;
                }
            }
        }

        await rm(manifestPath, { force: true });
    }

    getDb().delete(mediaCache).where(eq(mediaCache.chapterId, row.chapterId)).run();

    return {
        sourceSeriesId,
        sourceChapterId,
        removedFiles,
    };
}

export type DownloadScope = "all" | "unread" | "next50" | "next100";

export async function downloadChaptersBulk(sourceSeriesId: string, scope: DownloadScope) {
    const chapterList = await getChapterList(sourceSeriesId);
    const localSeriesId = await ensureSeriesRecord(sourceSeriesId);

    let chaptersToDownload: Chapter[];

    if (scope === "all") {
        chaptersToDownload = chapterList;
    } else if (scope === "unread") {
        // Get completed chapter IDs
        const completedRows = getDb()
            .select({ sourceChapterId: chapter.sourceChapterId })
            .from(chapterProgress)
            .innerJoin(chapter, eq(chapterProgress.chapterId, chapter.id))
            .where(
                and(
                    eq(chapterProgress.seriesId, localSeriesId),
                    eq(chapterProgress.completed, true),
                ),
            )
            .all();
        const completedIds = new Set(completedRows.map((r) => r.sourceChapterId));
        chaptersToDownload = chapterList.filter((ch) => !completedIds.has(ch.sourceChapterId));
    } else {
        // next50 or next100
        const limit = scope === "next50" ? 50 : 100;

        // Find current reading position
        const completedRows = getDb()
            .select({ sourceChapterId: chapter.sourceChapterId })
            .from(chapterProgress)
            .innerJoin(chapter, eq(chapterProgress.chapterId, chapter.id))
            .where(
                and(
                    eq(chapterProgress.seriesId, localSeriesId),
                    eq(chapterProgress.completed, true),
                ),
            )
            .all();
        const completedIds = new Set(completedRows.map((r) => r.sourceChapterId));
        const unread = chapterList.filter((ch) => !completedIds.has(ch.sourceChapterId));
        chaptersToDownload = unread.slice(0, limit);
    }

    // Skip already downloaded chapters
    const alreadyDownloaded = getDb()
        .select({ sourceChapterId: chapter.sourceChapterId })
        .from(mediaCache)
        .innerJoin(chapter, eq(mediaCache.chapterId, chapter.id))
        .innerJoin(
            sourceMapping,
            and(eq(sourceMapping.seriesId, chapter.seriesId), eq(sourceMapping.source, SOURCE)),
        )
        .where(
            and(
                eq(sourceMapping.sourceSeriesId, sourceSeriesId),
                eq(mediaCache.state, "ready"),
            ),
        )
        .all();
    const downloadedIds = new Set(alreadyDownloaded.map((r) => r.sourceChapterId));
    chaptersToDownload = chaptersToDownload.filter((ch) => !downloadedIds.has(ch.sourceChapterId));

    const failures: Array<{ chapterId: string; error: string }> = [];
    let downloaded = 0;

    for (const chapterItem of chaptersToDownload) {
        try {
            await pinChapter(sourceSeriesId, chapterItem.sourceChapterId, chapterItem);
            downloaded += 1;
        } catch (error) {
            failures.push({
                chapterId: chapterItem.sourceChapterId,
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }

    return {
        sourceSeriesId,
        scope,
        requested: chaptersToDownload.length,
        downloaded,
        skipped: downloadedIds.size,
        failures,
    };
}

export async function cleanupUnpinnedCache(maxAgeDays = 7) {
    const cutoff = Date.now() - Math.max(maxAgeDays, 0) * 24 * 60 * 60 * 1000;
    const references = await loadPinnedReferences();
    const allFiles = await listFilesRecursive(CACHE_DIR);

    let removedFiles = 0;
    let removedBytes = 0;

    for (const filePath of allFiles) {
        if (references.pinnedFiles.has(filePath)) {
            continue;
        }

        const fileStat = await stat(filePath);
        const isManifest = filePath.startsWith(PIN_MANIFEST_DIR);

        if (isManifest && references.pinnedManifestPaths.has(filePath)) {
            continue;
        }

        if (fileStat.mtimeMs > cutoff) {
            continue;
        }

        await rm(filePath, { force: true });
        removedFiles += 1;
        removedBytes += fileStat.size;
    }

    return {
        removedFiles,
        removedBytes,
    };
}
