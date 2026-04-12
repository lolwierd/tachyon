/**
 * Pure helpers for the on-device cache scope logic. Kept free of IDB / fetch
 * dependencies so they can be unit-tested without a browser environment.
 *
 * Mirrors the `DownloadScope` shape in
 * `src/app/(main)/series/[id]/offline-actions.ts` so the /cache UI can reuse
 * the same vocabulary as the server-side /downloads UI.
 */

export type CacheScope = "all" | "unread" | "next5" | "next10" | "next50" | "next100";

type ChapterReadState = "read" | "unread" | "in-progress";

export interface ChapterForCacheAction {
    sourceChapterId: string;
    readState: ChapterReadState;
}

/**
 * Return the source chapter IDs that should be cached for a given scope,
 * excluding chapters that are already cached on this device.
 *
 * The chapter order passed in is assumed to match how the series page
 * renders them (by chapterNo ascending). "next N" returns the first N unread
 * chapters in that order — same semantics as the server downloads flow.
 */
export function getBulkCacheTargetChapterIds(
    chapters: ChapterForCacheAction[],
    cachedChapterIds: Set<string>,
    scope: CacheScope,
): string[] {
    let candidates = chapters.filter((chapter) => !cachedChapterIds.has(chapter.sourceChapterId));

    if (scope === "unread") {
        candidates = candidates.filter((chapter) => chapter.readState !== "read");
    } else if (
        scope === "next5" ||
        scope === "next10" ||
        scope === "next50" ||
        scope === "next100"
    ) {
        const limit = scope === "next5" ? 5 : scope === "next10" ? 10 : scope === "next50" ? 50 : 100;
        candidates = candidates
            .filter((chapter) => chapter.readState !== "read")
            .slice(0, limit);
    }

    return candidates.map((chapter) => chapter.sourceChapterId);
}

/**
 * Returns the source chapter IDs of chapters that are both marked read and
 * currently cached on this device. Used by the "Delete read (cached)" button
 * so the label can show a live count.
 */
export function getReadCachedChapterIds(
    chapters: ChapterForCacheAction[],
    cachedChapterIds: Set<string>,
): string[] {
    return chapters
        .filter(
            (chapter) =>
                chapter.readState === "read" && cachedChapterIds.has(chapter.sourceChapterId),
        )
        .map((chapter) => chapter.sourceChapterId);
}

/**
 * Human-readable formatter for cache storage sizes. Matches the casing used
 * throughout the app so the /cache page renders consistently with /downloads.
 */
export function formatCacheBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
