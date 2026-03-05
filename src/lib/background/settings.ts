import { getDb } from "@/lib/db";
import { appSetting } from "@/lib/db/schema";

export interface BackgroundSettings {
  downloadConcurrency: number;
  downloadConcurrencyFallback: number;
  nextNAfterRead: number;
  autoDeleteReadEnabled: boolean;
  autoDeleteKeepLastN: number;
  defaultNewChapterLimit: number;
  failureThreshold: number;
  fallbackCooldownMinutes: number;
  fallbackUntil: string | null;
}

const DEFAULT_SETTINGS: BackgroundSettings = {
  downloadConcurrency: 4,
  downloadConcurrencyFallback: 2,
  nextNAfterRead: 10,
  autoDeleteReadEnabled: false,
  autoDeleteKeepLastN: 5,
  defaultNewChapterLimit: 3,
  failureThreshold: 8,
  fallbackCooldownMinutes: 30,
  fallbackUntil: null,
};

const KEYS = {
  downloadConcurrency: "download_concurrency",
  downloadConcurrencyFallback: "download_concurrency_fallback",
  nextNAfterRead: "next_n_after_read",
  autoDeleteReadEnabled: "auto_delete_read_enabled",
  autoDeleteKeepLastN: "auto_delete_keep_last_n",
  defaultNewChapterLimit: "default_new_chapter_limit",
  failureThreshold: "download_failure_threshold",
  fallbackCooldownMinutes: "download_fallback_cooldown_minutes",
  fallbackUntil: "download_fallback_until",
} as const;

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function parseValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function setRawSetting(key: string, value: unknown) {
  const now = new Date();
  getDb().insert(appSetting).values({
    key,
    valueJson: JSON.stringify(value),
    updatedAt: now,
  }).onConflictDoUpdate({
    target: appSetting.key,
    set: {
      valueJson: JSON.stringify(value),
      updatedAt: now,
    },
  }).run();
}

function getAllRawSettings(): Map<string, string> {
  const rows = getDb().select({ key: appSetting.key, valueJson: appSetting.valueJson })
    .from(appSetting)
    .all();
  return new Map(rows.map((r) => [r.key, r.valueJson]));
}

function rawValue<T>(settings: Map<string, string>, key: string, fallback: T): T {
  return parseValue(settings.get(key), fallback);
}

export function getBackgroundSettings(): BackgroundSettings {
  const raw = getAllRawSettings();
  const fallbackUntil = rawValue<string | null>(raw, KEYS.fallbackUntil, DEFAULT_SETTINGS.fallbackUntil);

  return {
    downloadConcurrency: clampInt(
      rawValue<number>(raw, KEYS.downloadConcurrency, DEFAULT_SETTINGS.downloadConcurrency),
      1,
      16,
    ),
    downloadConcurrencyFallback: clampInt(
      rawValue<number>(raw, KEYS.downloadConcurrencyFallback, DEFAULT_SETTINGS.downloadConcurrencyFallback),
      1,
      16,
    ),
    nextNAfterRead: clampInt(
      rawValue<number>(raw, KEYS.nextNAfterRead, DEFAULT_SETTINGS.nextNAfterRead),
      0,
      200,
    ),
    autoDeleteReadEnabled: Boolean(
      rawValue<boolean>(raw, KEYS.autoDeleteReadEnabled, DEFAULT_SETTINGS.autoDeleteReadEnabled),
    ),
    autoDeleteKeepLastN: clampInt(
      rawValue<number>(raw, KEYS.autoDeleteKeepLastN, DEFAULT_SETTINGS.autoDeleteKeepLastN),
      0,
      200,
    ),
    defaultNewChapterLimit: clampInt(
      rawValue<number>(raw, KEYS.defaultNewChapterLimit, DEFAULT_SETTINGS.defaultNewChapterLimit),
      1,
      50,
    ),
    failureThreshold: clampInt(
      rawValue<number>(raw, KEYS.failureThreshold, DEFAULT_SETTINGS.failureThreshold),
      1,
      100,
    ),
    fallbackCooldownMinutes: clampInt(
      rawValue<number>(raw, KEYS.fallbackCooldownMinutes, DEFAULT_SETTINGS.fallbackCooldownMinutes),
      1,
      24 * 60,
    ),
    fallbackUntil,
  };
}

export function updateBackgroundSettings(input: Partial<BackgroundSettings>) {
  const current = getBackgroundSettings();
  const next: BackgroundSettings = {
    ...current,
    ...input,
  };

  setRawSetting(KEYS.downloadConcurrency, clampInt(next.downloadConcurrency, 1, 16));
  setRawSetting(KEYS.downloadConcurrencyFallback, clampInt(next.downloadConcurrencyFallback, 1, 16));
  setRawSetting(KEYS.nextNAfterRead, clampInt(next.nextNAfterRead, 0, 200));
  setRawSetting(KEYS.autoDeleteReadEnabled, Boolean(next.autoDeleteReadEnabled));
  setRawSetting(KEYS.autoDeleteKeepLastN, clampInt(next.autoDeleteKeepLastN, 0, 200));
  setRawSetting(KEYS.defaultNewChapterLimit, clampInt(next.defaultNewChapterLimit, 1, 50));
  setRawSetting(KEYS.failureThreshold, clampInt(next.failureThreshold, 1, 100));
  setRawSetting(KEYS.fallbackCooldownMinutes, clampInt(next.fallbackCooldownMinutes, 1, 24 * 60));
  setRawSetting(KEYS.fallbackUntil, next.fallbackUntil ?? null);

  return getBackgroundSettings();
}

export function setDownloadFallbackWindow(until: Date | null) {
  setRawSetting(KEYS.fallbackUntil, until ? until.toISOString() : null);
}

export function isDownloadFallbackActive(now = new Date()) {
  const settings = getBackgroundSettings();
  if (!settings.fallbackUntil) {
    return false;
  }

  const until = new Date(settings.fallbackUntil);
  return Number.isFinite(until.getTime()) && until.getTime() > now.getTime();
}

export function getDefaultBackgroundSettings() {
  return { ...DEFAULT_SETTINGS };
}
