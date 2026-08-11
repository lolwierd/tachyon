/**
 * Live smoke tests — hit the real APIs to verify sources actually work.
 * Run with: pnpm test:run src/lib/sources/smoke.test.ts
 *
 * These tests are skipped by default in CI (they hit external services).
 * To run them: SMOKE=1 pnpm test:run src/lib/sources/smoke.test.ts
 */
import { describe, expect, it } from "vitest";
import { search as asuraSearch, getSeriesDetail as asuraDetail, getChapterList as asuraChapters, getChapterPages as asuraPages, clearCache as asuraClear } from "./asurascans";
import { search as flameSearch, getSeriesDetail as flameDetail, getChapterList as flameChapters, getChapterPages as flamePages, clearCache as flameClear, fetchBuildId } from "./flamecomics";
import { search as mgekoSearch, getSeriesDetail as mgekoDetail, getChapterList as mgekoChapters, getChapterPages as mgekoPages, clearCache as mgekoClear } from "./mgeko";

const SMOKE = process.env.SMOKE === "1";
const smoke = SMOKE ? it : it.skip;

describe("AsuraScans live smoke test", () => {
  smoke("search → detail → chapters → pages", async () => {
    asuraClear();

    // Search
    const results = await asuraSearch("reaper");
    console.log(`Asura search: ${results.length} results`);
    expect(results.length).toBeGreaterThan(0);
    const first = results[0]!;
    console.log(`  First result: "${first.title}" slug=${first.sourceId} cover=${first.coverUrl?.substring(0, 60)}`);
    expect(first.title).toBeTruthy();
    expect(first.sourceId).toBeTruthy();

    // Detail
    const detail = await asuraDetail(first.sourceId);
    console.log(`Asura detail: "${detail.title}" authors=${detail.authors} desc=${detail.description?.substring(0, 60)}`);
    expect(detail.title).toBeTruthy();

    // Chapters
    const chapters = await asuraChapters(first.sourceId);
    console.log(`Asura chapters: ${chapters.length} chapters`);
    expect(chapters.length).toBeGreaterThan(0);
    const ch = chapters[0]!;
    console.log(`  First chapter: "${ch.title}" id=${ch.sourceChapterId}`);
    expect(ch.sourceChapterId).toContain("/chapter/");

    // Pages
    const pages = await asuraPages(ch.sourceChapterId);
    console.log(`Asura pages: ${pages.length} pages`);
    console.log(`  Page 0: ${pages[0]?.imageUrl?.substring(0, 80)}`);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]!.imageUrl).toMatch(/^https?:\/\//);
  }, 60000);
});

describe("FlameComics live smoke test", () => {
  smoke("buildId → search → detail → chapters → pages", async () => {
    flameClear();

    // BuildId
    const buildId = await fetchBuildId();
    console.log(`Flame buildId: ${buildId}`);
    expect(buildId).toBeTruthy();

    // Search (empty query returns all, filter client-side)
    const results = await flameSearch("omniscient");
    console.log(`Flame search: ${results.length} results`);
    // Flame may have limited catalog — if no match, try empty
    let first = results[0];
    if (!first) {
      const all = await flameSearch("");
      console.log(`Flame all series: ${all.length}`);
      expect(all.length).toBeGreaterThan(0);
      first = all[0]!;
    }
    console.log(`  First result: "${first.title}" id=${first.sourceId} cover=${first.coverUrl?.substring(0, 60)}`);
    expect(first.title).toBeTruthy();

    // Detail
    const detail = await flameDetail(first.sourceId);
    console.log(`Flame detail: "${detail.title}" authors=${detail.authors} desc=${detail.description?.substring(0, 60)}`);
    expect(detail.title).toBeTruthy();

    // Chapters
    const chapters = await flameChapters(first.sourceId);
    console.log(`Flame chapters: ${chapters.length} chapters`);
    expect(chapters.length).toBeGreaterThan(0);
    const ch = chapters[0]!;
    console.log(`  First chapter: "${ch.title}" id=${ch.sourceChapterId}`);

    // Pages
    const pages = await flamePages(ch.sourceChapterId);
    console.log(`Flame pages: ${pages.length} pages`);
    console.log(`  Page 0: ${pages[0]?.imageUrl?.substring(0, 100)}`);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]!.imageUrl).toMatch(/^https?:\/\//);
  }, 120000);
});

describe("Mgeko live smoke test", () => {
  smoke("search → detail → chapters → pages", async () => {
    mgekoClear();

    const results = await mgekoSearch("solo leveling");
    console.log(`Mgeko search: ${results.length} results`);
    expect(results.length).toBeGreaterThan(0);
    const first = results.find((result) => result.sourceId === "solo-leveling-mg1") ?? results[0]!;
    console.log(`  First result: "${first.title}" slug=${first.sourceId} cover=${first.coverUrl?.substring(0, 80)}`);
    expect(first.title).toBeTruthy();

    const detail = await mgekoDetail(first.sourceId);
    console.log(`Mgeko detail: "${detail.title}" authors=${detail.authors} status=${detail.status}`);
    expect(detail.title).toBeTruthy();

    const chapters = await mgekoChapters(first.sourceId);
    console.log(`Mgeko chapters: ${chapters.length} chapters`);
    expect(chapters.length).toBeGreaterThan(0);
    expect(chapters.find((chapter) => chapter.sourceChapterId.includes("179-5"))?.chapterNo).toBe(179.5);
    const chapter = chapters[chapters.length - 1]!;
    console.log(`  Last chapter: "${chapter.title}" id=${chapter.sourceChapterId}`);

    const pages = await mgekoPages(chapter.sourceChapterId);
    console.log(`Mgeko pages: ${pages.length} pages`);
    console.log(`  Page 0: ${pages[0]?.imageUrl?.substring(0, 100)}`);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]!.imageUrl).toMatch(/^https?:\/\//);
  }, 120000);
});
