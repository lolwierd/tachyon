import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { useTestDb } from "@/lib/db/test-utils";
import { series, sourceMapping } from "@/lib/db/schema";

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
});
