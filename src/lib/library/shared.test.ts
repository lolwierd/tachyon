import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { useTestDb } from "@/lib/db/test-utils";
import { series, sourceMapping } from "@/lib/db/schema";
import { resolveSourceForSeries } from "./shared";

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
});
