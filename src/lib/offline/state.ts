import { and, desc, eq } from "drizzle-orm";
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
import { ensureSeriesRecord, getSeriesMapping } from "@/lib/library/shared";
import { getSource } from "@/lib/sources/registry";
import "@/lib/sources/init";
import type { Chapter, ChapterPage } from "@/lib/sources/types";

interface PinManifest {
    sourceSeriesId: string;
    sourceChapterId: string;
    files: string[];
    pages?: ChapterPage[];
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
    const mapping = getSeriesMapping(sourceSeriesId);
    if (!mapping) throw new Error(`Series source not found for ${sourceSeriesId}`);
    const sourceName = mapping.source;
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
                eq(chapter.source, sourceName),
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
        const sourceInst = getSource(sourceName);
        if (!sourceInst) throw new Error(`Unknown source: ${sourceName}`);
        const chapterList = await sourceInst.getChapterList(mapping.sourceSeriesId);
        nextMeta = chapterList.find((item) => item.sourceChapterId === sourceChapterId);
    }

    const chapterId = crypto.randomUUID();
    const chapterNo = nextMeta?.chapterNo ?? 0;
    const title = nextMeta?.title ?? `Chapter ${chapterNo || "?"}`;

    const inserted = getDb().insert(chapter).values({
        id: chapterId,
        seriesId,
        source: sourceName,
        sourceChapterId,
        chapterNo,
        title,
        pageCount: 0,
        sortKey: chapterNo,
        createdAt: new Date(),
    }).onConflictDoNothing({
        target: [chapter.seriesId, chapter.source, chapter.sourceChapterId],
    }).run();

    if (inserted.changes === 0) {
        const concurrent = getDb()
            .select({
                id: chapter.id,
                chapterNo: chapter.chapterNo,
                title: chapter.title,
            })
            .from(chapter)
            .where(
                and(
                    eq(chapter.seriesId, seriesId),
                    eq(chapter.source, sourceName),
                    eq(chapter.sourceChapterId, sourceChapterId),
                ),
            )
            .get();

        if (concurrent) {
            return {
                chapterId: concurrent.id,
                chapterNo: concurrent.chapterNo,
                title: concurrent.title ?? `Chapter ${concurrent.chapterNo}`,
            };
        }

        throw new Error(
            `Chapter conflict but row not found: series=${seriesId} source=${sourceName} sourceChapter=${sourceChapterId}`,
        );
    }

    return {
        chapterId,
        chapterNo,
        title,
    };
}

export async function getOfflineOverview(sourceSeriesId?: string): Promise<OfflineOverview> {
    const targetSourceSeriesId = sourceSeriesId
        ? (getSeriesMapping(sourceSeriesId)?.sourceSeriesId ?? sourceSeriesId)
        : undefined;

    const rows = targetSourceSeriesId
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
                eq(sourceMapping.seriesId, chapter.seriesId),
            )
            .where(eq(sourceMapping.sourceSeriesId, targetSourceSeriesId))
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
                eq(sourceMapping.seriesId, chapter.seriesId),
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
    options?: { signal?: AbortSignal },
): Promise<PinChapterResult> {
    const localSeriesId = await ensureSeriesRecord(sourceSeriesId);
    const localChapter = await ensureChapterRecord(
        localSeriesId,
        sourceSeriesId,
        sourceChapterId,
        chapterMeta,
    );

    const mapping = getSeriesMapping(sourceSeriesId);
    if (!mapping) throw new Error(`Series source not found for ${sourceSeriesId}`);
    const sourceName = mapping.source;
    const targetSourceSeriesId = mapping.sourceSeriesId;
    const source = getSource(sourceName);
    if (!source) throw new Error(`Unknown source: ${sourceName}`);
    const pages = await source.getChapterPages(sourceChapterId);
    ensurePinManifestDir();

    const referer = source.getChapterUrl?.(sourceChapterId)
        ?? (source.baseUrl.endsWith("/") ? source.baseUrl : `${source.baseUrl}/`);
    const origin = new URL(referer).origin;
    const files = new Set<string>();
    let bytes = 0;

    for (const page of pages) {
        options?.signal?.throwIfAborted();
        const result = await cacheRemotePage(page.imageUrl, {
            Referer: referer,
            Origin: origin,
            ...(sourceName === "madaradex" ? { "sec-fetch-site": "same-site" } : {}),
        }, {
            signal: options?.signal,
            sourceName,
            flareSolverrUrl: referer,
        });
        files.add(result.cachePath);
        bytes += result.data.byteLength;
    }

    const manifestPath = path.join(
        PIN_MANIFEST_DIR,
        safeManifestName(targetSourceSeriesId, sourceChapterId),
    );

    await writeFile(
        manifestPath,
        JSON.stringify(
            {
                sourceSeriesId: targetSourceSeriesId,
                sourceChapterId,
                files: [...files],
                pages,
                generatedAt: new Date().toISOString(),
            } satisfies PinManifest,
            null,
            2,
        ),
    );

    try {
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
    } catch (err) {
        // Clean up the manifest file so it doesn't become orphaned
        await rm(manifestPath, { force: true });
        throw err;
    }

    return {
        sourceSeriesId: targetSourceSeriesId,
        sourceChapterId,
        pageCount: pages.length,
        bytes,
        state: pages.length === files.size ? "ready" : "partial",
    };
}

export async function unpinChapter(sourceSeriesId: string, sourceChapterId: string) {
    const mapping = getSeriesMapping(sourceSeriesId);
    const targetSourceSeriesId = mapping ? mapping.sourceSeriesId : sourceSeriesId;

    const row = getDb().select({
        chapterId: chapter.id,
        manifestPath: mediaCache.path,
    })
        .from(chapter)
        .innerJoin(
            sourceMapping,
            eq(sourceMapping.seriesId, chapter.seriesId),
        )
        .leftJoin(mediaCache, eq(mediaCache.chapterId, chapter.id))
        .where(
            and(
                eq(sourceMapping.sourceSeriesId, targetSourceSeriesId),
                eq(chapter.sourceChapterId, sourceChapterId),
            ),
        )
        .get();

    if (!row) {
        return { sourceSeriesId: targetSourceSeriesId, sourceChapterId, removedFiles: 0 };
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
        sourceSeriesId: targetSourceSeriesId,
        sourceChapterId,
        removedFiles,
    };
}

export async function deleteReadChaptersKeepLastN(sourceSeriesId: string, keepLastN: number) {
    const mapping = getSeriesMapping(sourceSeriesId);
    const targetSourceSeriesId = mapping ? mapping.sourceSeriesId : sourceSeriesId;

    const rows = getDb().select({
        sourceChapterId: chapter.sourceChapterId,
        completedAt: chapterProgress.completedAt,
    })
        .from(mediaCache)
        .innerJoin(chapter, eq(mediaCache.chapterId, chapter.id))
        .innerJoin(
            sourceMapping,
            eq(sourceMapping.seriesId, chapter.seriesId),
        )
        .innerJoin(chapterProgress, eq(chapterProgress.chapterId, chapter.id))
        .where(
            and(
                eq(sourceMapping.sourceSeriesId, targetSourceSeriesId),
                eq(mediaCache.state, "ready"),
                eq(chapterProgress.completed, true),
            ),
        )
        .orderBy(desc(chapterProgress.completedAt))
        .all();

    const normalizedKeepLastN = Math.max(Math.trunc(keepLastN), 0);
    const candidates = normalizedKeepLastN > 0 ? rows.slice(normalizedKeepLastN) : rows;
    const failures: Array<{ chapterId: string; error: string }> = [];
    let deleted = 0;
    let removedFiles = 0;

    for (const row of candidates) {
        try {
            const result = await unpinChapter(targetSourceSeriesId, row.sourceChapterId);
            deleted += 1;
            removedFiles += result.removedFiles;
        } catch (error) {
            failures.push({
                chapterId: row.sourceChapterId,
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }

    return {
        sourceSeriesId: targetSourceSeriesId,
        requested: candidates.length,
        kept: Math.min(normalizedKeepLastN, rows.length),
        deleted,
        removedFiles,
        failures,
    };
}

export async function deleteAllSeriesDownloads(sourceSeriesId: string) {
    const mapping = getSeriesMapping(sourceSeriesId);
    const targetSourceSeriesId = mapping ? mapping.sourceSeriesId : sourceSeriesId;

    const rows = getDb().select({
        sourceChapterId: chapter.sourceChapterId,
    })
        .from(mediaCache)
        .innerJoin(chapter, eq(mediaCache.chapterId, chapter.id))
        .innerJoin(
            sourceMapping,
            eq(sourceMapping.seriesId, chapter.seriesId),
        )
        .where(eq(sourceMapping.sourceSeriesId, targetSourceSeriesId))
        .all();

    const failures: Array<{ chapterId: string; error: string }> = [];
    let deleted = 0;
    let removedFiles = 0;

    for (const row of rows) {
        try {
            const result = await unpinChapter(targetSourceSeriesId, row.sourceChapterId);
            deleted += 1;
            removedFiles += result.removedFiles;
        } catch (error) {
            failures.push({
                chapterId: row.sourceChapterId,
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }

    return {
        sourceSeriesId: targetSourceSeriesId,
        deleted,
        removedFiles,
        failures,
    };
}

export async function getChapterPagesFromManifest(
    sourceSeriesId: string,
    sourceChapterId: string,
    sourceName?: string | null,
): Promise<ChapterPage[] | null> {
    const mapping = getSeriesMapping(sourceSeriesId, sourceName ?? undefined);
    if (!mapping) return null;
    const manifestPath = path.join(
        PIN_MANIFEST_DIR,
        safeManifestName(mapping.sourceSeriesId, sourceChapterId),
    );
    const manifest = await readManifest(manifestPath);
    if (!manifest?.pages?.length) return null;
    return manifest.pages;
}

export async function cleanupUnpinnedCache() {
    const references = await loadPinnedReferences();
    const allFiles = await listFilesRecursive(CACHE_DIR);

    let removedFiles = 0;
    let removedBytes = 0;

    for (const filePath of allFiles) {
        try {
            if (references.pinnedFiles.has(filePath)) {
                continue;
            }

            const fileStat = await stat(filePath);
            const isManifest = filePath.startsWith(PIN_MANIFEST_DIR);

            if (isManifest && references.pinnedManifestPaths.has(filePath)) {
                continue;
            }

            await rm(filePath, { force: true });
            removedFiles += 1;
            removedBytes += fileStat.size;
        } catch {
            // File was deleted between listing and stat — skip it
            continue;
        }
    }

    return {
        removedFiles,
        removedBytes,
    };
}
