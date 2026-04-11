import { describe, expect, it } from "vitest";
import {
    formatCacheBytes,
    getBulkCacheTargetChapterIds,
    getReadCachedChapterIds,
} from "./cache-actions";

const chapters = [
    { sourceChapterId: "c1", readState: "read" as const },
    { sourceChapterId: "c2", readState: "in-progress" as const },
    { sourceChapterId: "c3", readState: "unread" as const },
    { sourceChapterId: "c4", readState: "unread" as const },
];

describe("cache actions helpers", () => {
    it("excludes already cached chapters from bulk cache targets", () => {
        expect(
            getBulkCacheTargetChapterIds(chapters, new Set(["c2", "c4"]), "all"),
        ).toEqual(["c1", "c3"]);
    });

    it("targets only non-read chapters for unread cache", () => {
        expect(
            getBulkCacheTargetChapterIds(chapters, new Set(["c4"]), "unread"),
        ).toEqual(["c2", "c3"]);
    });

    it("limits next N to unread chapters that are not already cached", () => {
        const many = Array.from({ length: 60 }, (_, index) => ({
            sourceChapterId: `c${index + 1}`,
            readState: index < 5 ? ("read" as const) : ("unread" as const),
        }));

        const ids = getBulkCacheTargetChapterIds(many, new Set(["c6", "c7"]), "next10");
        expect(ids).toHaveLength(10);
        expect(ids.slice(0, 3)).toEqual(["c8", "c9", "c10"]);
    });

    it("supports next50 and next100 limits", () => {
        const many = Array.from({ length: 150 }, (_, index) => ({
            sourceChapterId: `c${index + 1}`,
            readState: "unread" as const,
        }));

        expect(getBulkCacheTargetChapterIds(many, new Set(), "next50")).toHaveLength(50);
        expect(getBulkCacheTargetChapterIds(many, new Set(), "next100")).toHaveLength(100);
    });

    it("returns only read chapters that are already cached", () => {
        expect(
            getReadCachedChapterIds(chapters, new Set(["c1", "c3", "c4"])),
        ).toEqual(["c1"]);
    });

    it("formats bytes in human-readable units", () => {
        expect(formatCacheBytes(0)).toBe("0 KB");
        expect(formatCacheBytes(-10)).toBe("0 KB");
        expect(formatCacheBytes(1024 * 500)).toBe("500 KB");
        expect(formatCacheBytes(1024 * 1024 * 3.5)).toBe("3.5 MB");
        expect(formatCacheBytes(1024 * 1024 * 1024 * 2.25)).toBe("2.25 GB");
    });
});
