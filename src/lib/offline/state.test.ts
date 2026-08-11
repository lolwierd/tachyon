import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { useTestDb } from "@/lib/db/test-utils";
import { chapter, mediaCache, series, sourceMapping } from "@/lib/db/schema";

const tempCacheDir = path.join("/tmp", "tachyon-offline-state-test-cache");
const tempPinDir = path.join(tempCacheDir, "pins");
const getChapterPagesMock = vi.fn();
const cacheRemotePageMock = vi.fn();

vi.mock("@/lib/sources/init", () => ({}));
vi.mock("@/lib/sources/registry", () => ({
  getSource: () => ({
    baseUrl: "https://example.test",
    getChapterPages: getChapterPagesMock,
  }),
}));
vi.mock("@/lib/media/cache", () => ({
  CACHE_DIR: tempCacheDir,
  PIN_MANIFEST_DIR: tempPinDir,
  ensurePinManifestDir: () => {
    mkdirSync(tempPinDir, { recursive: true });
  },
  cacheRemotePage: cacheRemotePageMock,
  ensureMediaCacheDir: () => {
    mkdirSync(tempCacheDir, { recursive: true });
  },
}));

describe("offline manifest state", () => {
  useTestDb();

  beforeEach(() => {
    rmSync(tempCacheDir, { recursive: true, force: true });
    getChapterPagesMock.mockReset();
    cacheRemotePageMock.mockReset();
    getChapterPagesMock.mockResolvedValue([
      { index: 0, imageUrl: "https://cdn.example/ch-1-0.jpg" },
      { index: 1, imageUrl: "https://cdn.example/ch-1-1.jpg" },
    ]);
    cacheRemotePageMock.mockImplementation(async (url: string) => ({
      data: Buffer.from(`cached:${url}`),
      contentType: "image/jpeg",
      cachePath: path.join(tempCacheDir, encodeURIComponent(url)),
      fromCache: false,
    }));
  });

  it("persists and reloads full chapter page metadata from the manifest", async () => {
    getDb().insert(series).values({
      id: "local-series-1",
      title: "Series 1",
      adult: false,
    }).run();
    getDb().insert(sourceMapping).values({
      id: "mapping-1",
      seriesId: "local-series-1",
      source: "oppai",
      sourceSeriesId: "source-series-1",
      sourceUrl: "https://example.test/source-series-1",
    }).run();

    const { getChapterPagesFromManifest, pinChapter } = await import("./state");
    await pinChapter("source-series-1", "chapter-1", {
      sourceChapterId: "chapter-1",
      chapterNo: 1,
      title: "Chapter 1",
    });

    await expect(getChapterPagesFromManifest("source-series-1", "chapter-1", "oppai")).resolves.toEqual([
      { index: 0, imageUrl: "https://cdn.example/ch-1-0.jpg" },
      { index: 1, imageUrl: "https://cdn.example/ch-1-1.jpg" },
    ]);
  });

  it("cleanup removes unpinned cache files regardless of age", async () => {
    const { cleanupUnpinnedCache } = await import("./state");

    mkdirSync(tempCacheDir, { recursive: true });
    const oldFile = path.join(tempCacheDir, "old.jpg");
    const freshFile = path.join(tempCacheDir, "fresh.jpg");
    const oldPayload = "old-cache";
    const freshPayload = "fresh-cache";
    writeFileSync(oldFile, oldPayload);
    writeFileSync(freshFile, freshPayload);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(oldFile, oneHourAgo, oneHourAgo);
    utimesSync(freshFile, new Date(), new Date());

    const result = await cleanupUnpinnedCache();

    expect(result.removedFiles).toBe(2);
    expect(result.removedBytes).toBe(Buffer.byteLength(oldPayload) + Buffer.byteLength(freshPayload));
  });

  it("keeps offline rows isolated when providers reuse an upstream series id", async () => {
    getDb().insert(series).values([
      { id: "local-oppai", title: "Oppai Series", adult: true },
      { id: "local-toonily", title: "Toonily Series", adult: true },
    ]).run();
    getDb().insert(sourceMapping).values([
      {
        id: "mapping-oppai",
        seriesId: "local-oppai",
        source: "oppai",
        sourceSeriesId: "shared-upstream",
        sourceUrl: "https://example.test/oppai",
      },
      {
        id: "mapping-toonily",
        seriesId: "local-toonily",
        source: "toonily",
        sourceSeriesId: "shared-upstream",
        sourceUrl: "https://example.test/toonily",
      },
    ]).run();

    getDb().insert(chapter).values([
      {
        id: "chapter-oppai",
        seriesId: "local-oppai",
        source: "oppai",
        sourceChapterId: "shared-upstream/chapter-1",
        chapterNo: 1,
        title: "Oppai chapter",
        sortKey: 1,
      },
      {
        id: "chapter-toonily",
        seriesId: "local-toonily",
        source: "toonily",
        sourceChapterId: "shared-upstream/chapter-1",
        chapterNo: 1,
        title: "Toonily chapter",
        sortKey: 1,
      },
    ]).run();
    getDb().insert(mediaCache).values([
      { chapterId: "chapter-oppai", state: "ready", bytes: 1, path: "/tmp/oppai-manifest" },
      { chapterId: "chapter-toonily", state: "ready", bytes: 2, path: "/tmp/toonily-manifest" },
    ]).run();

    const { getOfflineOverview } = await import("./state");
    const overview = await getOfflineOverview("shared-upstream", "oppai");

    expect(overview.chapters).toEqual([
      expect.objectContaining({
        source: "oppai",
        sourceSeriesId: "shared-upstream",
        title: "Oppai chapter",
      }),
    ]);
  });
});
