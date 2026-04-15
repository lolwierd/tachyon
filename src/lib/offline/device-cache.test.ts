import { describe, expect, it } from "vitest";
import { buildReaderPrecacheUrls } from "./device-cache";

// The reader view (src/app/read/[seriesId]/[...chapterId]/reader-view.tsx)
// constructs three URLs on mount using template literals + encodeURIComponent.
// The SW's Cache API keys by exact URL string, so any drift between the
// precache URL and the reader's fetch URL causes silent cache misses offline.
// These tests lock the shapes together; update both sites if either changes.
function expectedReaderUrls(seriesId: string, chapterId: string, source?: string): string[] {
    const s = encodeURIComponent(seriesId);
    const c = encodeURIComponent(chapterId);
    const suffix = source ? `?source=${encodeURIComponent(source)}` : "";
    const stateSuffix = source ? `&source=${encodeURIComponent(source)}` : "";
    return [
        `/api/series/${s}${suffix}`,
        `/api/series/${s}/chapters${suffix}`,
        `/api/reader/state?seriesId=${s}&chapterId=${c}${stateSuffix}`,
    ];
}

describe("buildReaderPrecacheUrls", () => {
    it("matches reader-view URL shape with sourceName set", () => {
        const urls = buildReaderPrecacheUrls({
            seriesId: "abc",
            chapterId: "ch-1",
            sourceName: "mangadex",
        });
        expect(urls).toEqual(expectedReaderUrls("abc", "ch-1", "mangadex"));
    });

    it("omits the source param when sourceName is undefined", () => {
        const urls = buildReaderPrecacheUrls({
            seriesId: "abc",
            chapterId: "ch-1",
            sourceName: undefined,
        });
        expect(urls).toEqual(expectedReaderUrls("abc", "ch-1"));
    });

    it("encodes spaces as %20, not + (cache-key parity with reader-view)", () => {
        // reader-view.tsx:544 uses encodeURIComponent which emits %20. If this
        // helper ever regresses to URLSearchParams, spaces would become '+' and
        // the SW Cache API would treat the two URLs as distinct keys.
        const urls = buildReaderPrecacheUrls({
            seriesId: "series with space",
            chapterId: "chapter with space",
            sourceName: "source with space",
        });
        for (const url of urls) {
            expect(url).not.toContain("+");
            expect(url).toContain("%20");
        }
        expect(urls).toEqual(
            expectedReaderUrls("series with space", "chapter with space", "source with space"),
        );
    });

    it("preserves query-param ordering (seriesId before chapterId in state URL)", () => {
        const [, , stateUrl] = buildReaderPrecacheUrls({
            seriesId: "s",
            chapterId: "c",
            sourceName: "m",
        });
        expect(stateUrl).toBe("/api/reader/state?seriesId=s&chapterId=c&source=m");
    });
});
