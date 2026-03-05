import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { useTestDb } from "@/lib/db/test-utils";
import { appSetting } from "@/lib/db/schema";
import {
  getBackgroundSettings,
  getDefaultBackgroundSettings,
  isDownloadFallbackActive,
  setDownloadFallbackWindow,
  updateBackgroundSettings,
} from "@/lib/background/settings";

describe("background settings", () => {
  useTestDb();
  it("reads and returns defaults", () => {
    const defaults = getDefaultBackgroundSettings();
    const updated = updateBackgroundSettings(defaults);

    expect(updated).toEqual(defaults);
    expect(getBackgroundSettings()).toEqual(defaults);
  });

  it("clamps numeric settings to safe ranges", () => {
    const next = updateBackgroundSettings({
      downloadConcurrency: 999,
      downloadConcurrencyFallback: 0,
      nextNAfterRead: -4,
      autoDeleteKeepLastN: 9999,
      defaultNewChapterLimit: 0,
      failureThreshold: 999,
      fallbackCooldownMinutes: 0,
    });

    expect(next.downloadConcurrency).toBe(16);
    expect(next.downloadConcurrencyFallback).toBe(1);
    expect(next.nextNAfterRead).toBe(0);
    expect(next.autoDeleteKeepLastN).toBe(200);
    expect(next.defaultNewChapterLimit).toBe(1);
    expect(next.failureThreshold).toBe(100);
    expect(next.fallbackCooldownMinutes).toBe(1);
  });

  it("falls back when stored JSON is invalid", () => {
    const defaults = getDefaultBackgroundSettings();

    getDb()
      .insert(appSetting)
      .values({
        key: "download_concurrency",
        valueJson: "{",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appSetting.key,
        set: {
          valueJson: "{",
          updatedAt: new Date(),
        },
      })
      .run();

    const settings = getBackgroundSettings();
    expect(settings.downloadConcurrency).toBe(defaults.downloadConcurrency);
  });

  it("tracks fallback window activation", () => {
    const future = new Date(Date.now() + 5 * 60 * 1000);
    const past = new Date(Date.now() - 5 * 60 * 1000);

    setDownloadFallbackWindow(future);
    expect(isDownloadFallbackActive()).toBe(true);

    setDownloadFallbackWindow(past);
    expect(isDownloadFallbackActive()).toBe(false);

    updateBackgroundSettings({ fallbackUntil: "invalid-date" });
    expect(isDownloadFallbackActive()).toBe(false);

    setDownloadFallbackWindow(null);
    expect(isDownloadFallbackActive()).toBe(false);
  });
});
