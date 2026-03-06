import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { useTestDb } from "@/lib/db/test-utils";
import { libraryEntry, series, sourceMapping } from "@/lib/db/schema";
import { getLibraryEntry } from "./state";

describe("library state", () => {
  useTestDb();

  it("returns an existing library entry when looked up by local series id", () => {
    const seriesId = `local-${crypto.randomUUID()}`;
    getDb().insert(series).values({
      id: seriesId,
      title: "One Piece",
      adult: false,
    }).run();
    getDb().insert(sourceMapping).values({
      id: `mapping-${crypto.randomUUID()}`,
      seriesId,
      source: "weebcentral",
      sourceSeriesId: "one-piece",
      sourceUrl: "https://example.test/one-piece",
    }).run();
    getDb().insert(libraryEntry).values({
      seriesId,
      status: "reading",
    }).run();

    const entry = getLibraryEntry(seriesId);

    expect(entry).toMatchObject({
      seriesId,
      sourceSeriesId: "one-piece",
      status: "reading",
      title: "One Piece",
    });
  });
});
