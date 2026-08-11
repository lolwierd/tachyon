import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { useTestDb } from "@/lib/db/test-utils";
import { series, sourceMapping } from "@/lib/db/schema";
import "@/lib/sources/init";
import { ensureSeriesRecord, resolveSourceForSeries } from "./shared";

describe("library shared source resolution", () => {
    useTestDb();

    it("prefers explicit source over existing mappings", () => {
        const seriesId = `series-${crypto.randomUUID()}`;

        getDb().insert(series).values({
            id: seriesId,
            title: "Secret Class",
            adult: true,
        }).run();

        getDb().insert(sourceMapping).values({
            id: `mapping-${crypto.randomUUID()}`,
            seriesId,
            source: "toonily",
            sourceSeriesId: "secret-class",
            sourceUrl: "https://toonily.me/secret-class",
        }).run();

        expect(resolveSourceForSeries("secret-class", "oppai")).toBe("oppai");
        expect(resolveSourceForSeries("secret-class")).toBe("toonily");
    });

    it("uses a source-specific series URL when persisting a mapping", async () => {
        const seriesId = await ensureSeriesRecord(
            "solo-leveling-mg1",
            {
                sourceId: "solo-leveling-mg1",
                title: "Solo Leveling",
                slug: "solo-leveling-mg1",
                coverUrl: "https://imgsrv5.com/avatar/cover.jpg",
                description: "",
                authors: ["Sung-Lak Jang"],
                tags: ["manhwa"],
                type: "Manhwa",
                status: "Complete",
                year: null,
                isAdult: false,
                isOfficial: false,
                anilistUrl: null,
                relatedSeries: [],
            },
            "mgeko",
        );

        const mapping = getDb()
            .select()
            .from(sourceMapping)
            .where(eq(sourceMapping.seriesId, seriesId))
            .get();

        expect(mapping?.source).toBe("mgeko");
        expect(mapping?.sourceUrl).toBe("https://www.mgeko.cc/manga/solo-leveling-mg1/");
    });

    it("repairs an existing mapping's generic URL from the source adapter", async () => {
        const seriesId = `series-${crypto.randomUUID()}`;
        getDb().insert(series).values({
            id: seriesId,
            title: "Solo Leveling",
            adult: false,
        }).run();
        getDb().insert(sourceMapping).values({
            id: `mapping-${crypto.randomUUID()}`,
            seriesId,
            source: "mgeko",
            sourceSeriesId: "solo-leveling-mg1",
            sourceUrl: "https://weebcentral.com/series/solo-leveling-mg1/",
        }).run();

        await ensureSeriesRecord("solo-leveling-mg1", undefined, "mgeko");

        const mapping = getDb()
            .select()
            .from(sourceMapping)
            .where(eq(sourceMapping.seriesId, seriesId))
            .get();
        expect(mapping?.sourceUrl).toBe("https://www.mgeko.cc/manga/solo-leveling-mg1/");
    });

    it("rejects an unknown source before using supplied detail metadata", async () => {
        await expect(ensureSeriesRecord("unknown-series", undefined, "unknown-source"))
            .rejects.toThrow("Unknown source: unknown-source");
    });
});
