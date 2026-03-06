import { describe, expect, it } from "vitest";
import {
  buildReaderHref,
  buildSeriesApiPath,
  buildSeriesHref,
  decodeReaderSegment,
  encodeReaderSegment,
} from "./url";

describe("reader url helpers", () => {
  it("encodes opaque reader segments and decodes them back", () => {
    const seriesId = "a-secret-lesson-with-my-younger-sister";
    const chapterId = "a-secret-lesson-with-my-younger-sister/chapter-3";

    const encodedSeriesId = encodeReaderSegment(seriesId);
    const encodedChapterId = encodeReaderSegment(chapterId);

    expect(encodedSeriesId.startsWith("~")).toBe(true);
    expect(encodedChapterId.startsWith("~")).toBe(true);
    expect(encodedSeriesId).not.toContain(seriesId);
    expect(encodedChapterId).not.toContain("chapter-3/");
    expect(decodeReaderSegment(encodedSeriesId)).toBe(seriesId);
    expect(decodeReaderSegment(encodedChapterId)).toBe(chapterId);
    expect(buildReaderHref(seriesId, chapterId)).toBe(`/read/${encodedSeriesId}/${encodedChapterId}`);
  });

  it("builds series and reader urls from the local series id", () => {
    expect(buildSeriesHref("series-local-1")).toBe("/series/series-local-1");
    expect(buildSeriesHref("series-raw-1", "madaradex")).toBe("/series/series-raw-1?source=madaradex");
    expect(buildSeriesApiPath("series-raw-1", "madaradex")).toBe("/api/series/series-raw-1?source=madaradex");
    expect(buildReaderHref("series-local-1", "chapter-1")).toBe(
      `/read/${encodeReaderSegment("series-local-1")}/${encodeReaderSegment("chapter-1")}`,
    );
    expect(buildReaderHref("series-local-1", "chapter-1", "oppai")).toBe(
      `/read/${encodeReaderSegment("series-local-1")}/${encodeReaderSegment("chapter-1")}?source=oppai`,
    );
  });

  it("leaves legacy raw reader segments unchanged", () => {
    expect(decodeReaderSegment("series-1")).toBe("series-1");
  });
});
