import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  anilistAccount,
  anilistSync,
  chapter,
  chapterProgress,
  libraryEntry,
  readingProgress,
  series,
  sourceMapping,
  syncLog,
} from "@/lib/db/schema";
import { ensureSeriesRecord, SOURCE } from "@/lib/library/shared";
import { getChapterList, getSeriesDetail, search } from "@/lib/sources/weebcentral";
import {
  createAniListAuthorizeUrl,
  exchangeAniListCode,
  getAniListMangaLibrary,
  getAniListViewer,
  isAniListConfigured,
  saveAniListMediaListEntry,
  type AniListLibraryEntry,
} from "./client";
import {
  decryptStoredSecret,
  encryptStoredSecret,
  hasTokenEncryptionKey,
  isEncryptedSecret,
} from "@/lib/server/secrets";

export type AniListRemoteStatus =
  | "CURRENT"
  | "COMPLETED"
  | "PAUSED"
  | "DROPPED"
  | "REPEATING"
  | "PLANNING";

export type AniListSyncState = "idle" | "running" | "success" | "error" | "conflict";

export interface AniListSyncOverview {
  configured: boolean;
  connected: boolean;
  viewerName: string | null;
  expiresAt: string | null;
  lastSyncAt: string | null;
  linkedSeriesCount: number;
  recentLogs: Array<{
    id: string;
    direction: "import" | "push" | "pull" | "merge";
    status: "success" | "error" | "conflict";
    details: string;
    createdAt: string | null;
  }>;
}

export interface AniListSeriesSyncStatus {
  configured: boolean;
  connected: boolean;
  linked: boolean;
  anilistId: number | null;
  syncState: AniListSyncState | null;
  lastDirection: "import" | "push" | "pull" | "merge" | null;
  lastSyncedAt: string | null;
  remoteStatus: AniListRemoteStatus | null;
  remoteProgress: number | null;
  lastError: string | null;
}

export interface AniListSyncRunResult {
  imported: number;
  skipped: number;
  pushed: number;
  pulled: number;
  conflicts: number;
}

export interface SyncDecision {
  direction: "push" | "pull" | "merge";
  status: AniListRemoteStatus;
  progress: number;
  hasConflict: boolean;
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function nowDate() {
  return new Date();
}

function normalizeTitle(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function logSync(
  direction: "import" | "push" | "pull" | "merge",
  status: "success" | "error" | "conflict",
  details: string,
  seriesId?: string,
) {
  getDb()
    .insert(syncLog)
    .values({
      id: crypto.randomUUID(),
      seriesId,
      direction,
      status,
      details,
      createdAt: nowDate(),
    })
    .run();
}

function mapLocalStatusToAniList(status: string): AniListRemoteStatus {
  switch (status) {
    case "reading":
      return "CURRENT";
    case "completed":
      return "COMPLETED";
    case "paused":
      return "PAUSED";
    case "dropped":
      return "DROPPED";
    case "rereading":
      return "REPEATING";
    default:
      return "PLANNING";
  }
}

function mapAniListStatusToLocal(status: string | null | undefined) {
  switch (status) {
    case "CURRENT":
      return "reading" as const;
    case "COMPLETED":
      return "completed" as const;
    case "PAUSED":
      return "paused" as const;
    case "DROPPED":
      return "dropped" as const;
    case "REPEATING":
      return "rereading" as const;
    default:
      return "planning" as const;
  }
}

function toRemoteUpdatedAt(value: number | null | undefined) {
  return value ? new Date(value * 1000) : null;
}

function getAccountRecord() {
  const row = getDb()
    .select()
    .from(anilistAccount)
    .orderBy(desc(anilistAccount.updatedAt))
    .get();

  if (!row) {
    return null;
  }

  let accessToken = row.accessToken;
  if (isEncryptedSecret(accessToken) && hasTokenEncryptionKey()) {
    accessToken = decryptStoredSecret(accessToken);
  } else if (!isEncryptedSecret(accessToken) && hasTokenEncryptionKey()) {
    const encrypted = encryptStoredSecret(accessToken);
    getDb()
      .update(anilistAccount)
      .set({
        accessToken: encrypted,
        updatedAt: nowDate(),
      })
      .where(eq(anilistAccount.id, row.id))
      .run();
  }

  return {
    ...row,
    accessToken,
  };
}

function requireAccount() {
  if (!isAniListConfigured()) {
    throw new Error("AniList sync is not configured");
  }

  const account = getAccountRecord();

  if (!account) {
    throw new Error("AniList account is not connected");
  }

  if (account.expiresAt && account.expiresAt.getTime() < Date.now()) {
    throw new Error("AniList token has expired — please reconnect your account");
  }

  return account;
}

function getLocalProgressForSeries(seriesId: string) {
  const completedRow = getDb()
    .select({ value: count() })
    .from(chapterProgress)
    .where(and(eq(chapterProgress.seriesId, seriesId), eq(chapterProgress.completed, true)))
    .get();
  const completedCount = completedRow?.value ?? 0;

  const progressRow = getDb()
    .select({
      progressUpdatedAt: readingProgress.updatedAt,
      currentChapterId: readingProgress.currentChapterId,
    })
    .from(readingProgress)
    .where(eq(readingProgress.seriesId, seriesId))
    .get();

  return {
    progress: completedCount,
    updatedAt: progressRow?.progressUpdatedAt ?? null,
    currentChapterId: progressRow?.currentChapterId ?? null,
  };
}

function getSortedChapters(seriesId: string) {
  return getDb()
    .select({
      id: chapter.id,
      sourceChapterId: chapter.sourceChapterId,
      chapterNo: chapter.chapterNo,
    })
    .from(chapter)
    .where(eq(chapter.seriesId, seriesId))
    .orderBy(chapter.sortKey)
    .all();
}

function ensureChapterCatalog(
  seriesId: string,
  chapters: Array<{ sourceChapterId: string; chapterNo: number; title: string }>,
) {
  for (const chapterItem of chapters) {
    getDb()
      .insert(chapter)
      .values({
        id: crypto.randomUUID(),
        seriesId,
        source: SOURCE,
        sourceChapterId: chapterItem.sourceChapterId,
        chapterNo: chapterItem.chapterNo,
        title: chapterItem.title,
        pageCount: 0,
        sortKey: chapterItem.chapterNo,
        createdAt: nowDate(),
      })
      .onConflictDoNothing({
        target: [chapter.seriesId, chapter.source, chapter.sourceChapterId],
      })
      .run();
  }
}

function applyRemoteProgress(seriesId: string, remoteProgress: number) {
  const chapters = getSortedChapters(seriesId);
  const now = nowDate();

  if (chapters.length === 0) {
    return;
  }

  const completedIds = chapters.slice(0, remoteProgress).map((item) => item.id);
  const nextChapter = remoteProgress >= chapters.length ? null : chapters[remoteProgress] ?? null;

  getDb().transaction((tx) => {
    for (const chapterItem of chapters) {
      if (!completedIds.includes(chapterItem.id)) {
        // Skip chapters that aren't completed remotely — never regress local progress
        continue;
      }

      tx
        .insert(chapterProgress)
        .values({
          chapterId: chapterItem.id,
          seriesId,
          lastPage: 0,
          completed: true,
          startedAt: now,
          completedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: chapterProgress.chapterId,
          set: {
            completed: true,
            completedAt: now,
            updatedAt: now,
          },
        })
        .run();
    }

    tx
      .insert(readingProgress)
      .values({
        seriesId,
        currentChapterId: nextChapter?.id ?? null,
        currentPage: 0,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: readingProgress.seriesId,
        set: {
          currentChapterId: nextChapter?.id ?? null,
          currentPage: 0,
          updatedAt: now,
        },
      })
      .run();
  });
}

function upsertSyncRecord(input: {
  seriesId: string;
  anilistId: number;
  mediaListEntryId?: number | null;
  syncState: AniListSyncState;
  lastDirection?: "import" | "push" | "pull" | "merge";
  remoteStatus?: string | null;
  remoteProgress?: number | null;
  remoteUpdatedAt?: Date | null;
  lastError?: string | null;
}) {
  getDb()
    .insert(anilistSync)
    .values({
      seriesId: input.seriesId,
      anilistId: input.anilistId,
      mediaListEntryId: input.mediaListEntryId ?? null,
      lastSyncedAt: nowDate(),
      syncState: input.syncState,
      lastDirection: input.lastDirection,
      lastError: input.lastError ?? null,
      remoteStatus: input.remoteStatus ?? null,
      remoteProgress: input.remoteProgress ?? 0,
      remoteUpdatedAt: input.remoteUpdatedAt ?? null,
    })
    .onConflictDoUpdate({
      target: anilistSync.seriesId,
      set: {
        anilistId: input.anilistId,
        mediaListEntryId: input.mediaListEntryId ?? null,
        lastSyncedAt: nowDate(),
        syncState: input.syncState,
        lastDirection: input.lastDirection,
        lastError: input.lastError ?? null,
        remoteStatus: input.remoteStatus ?? null,
        remoteProgress: input.remoteProgress ?? 0,
        remoteUpdatedAt: input.remoteUpdatedAt ?? null,
      },
    })
    .run();
}

function findLocalSeriesForRemoteEntry(entry: AniListLibraryEntry) {
  const directMatch = getDb()
    .select({
      id: series.id,
      sourceSeriesId: sourceMapping.sourceSeriesId,
    })
    .from(series)
    .innerJoin(sourceMapping, eq(sourceMapping.seriesId, series.id))
    .where(and(eq(sourceMapping.source, SOURCE), eq(series.anilistId, entry.media.id)))
    .get();

  if (directMatch) {
    return directMatch;
  }

  const titles = [
    entry.media.title.userPreferred,
    entry.media.title.english,
    entry.media.title.romaji,
    entry.media.title.native,
  ].filter((value): value is string => Boolean(value));

  const normalizedTitles = new Set(titles.map(normalizeTitle));
  const candidates = getDb()
    .select({
      id: series.id,
      title: series.title,
      sourceSeriesId: sourceMapping.sourceSeriesId,
    })
    .from(series)
    .innerJoin(sourceMapping, eq(sourceMapping.seriesId, series.id))
    .where(eq(sourceMapping.source, SOURCE))
    .all();

  return (
    candidates.find((candidate) => normalizedTitles.has(normalizeTitle(candidate.title))) ?? null
  );
}

function ensureLibraryEntry(seriesId: string, status: ReturnType<typeof mapAniListStatusToLocal>) {
  getDb()
    .insert(libraryEntry)
    .values({
      seriesId,
      status,
      addedAt: nowDate(),
      updatedAt: nowDate(),
    })
    .onConflictDoUpdate({
      target: libraryEntry.seriesId,
      set: {
        status,
        updatedAt: nowDate(),
      },
    })
    .run();
}

function isAfter(left: Date | null, right: Date | null) {
  if (!left) {
    return false;
  }

  if (!right) {
    return true;
  }

  return left.getTime() > right.getTime();
}

export function resolveAniListSyncDecision(input: {
  localStatus: string;
  localStatusUpdatedAt: Date | null;
  localProgress: number;
  localProgressUpdatedAt: Date | null;
  remoteStatus: string | null;
  remoteProgress: number | null;
  remoteUpdatedAt: Date | null;
  lastSyncedAt: Date | null;
}): SyncDecision {
  const remoteStatus = (input.remoteStatus ?? "PLANNING") as AniListRemoteStatus;
  const remoteProgress = input.remoteProgress ?? 0;
  const localStatus = mapLocalStatusToAniList(input.localStatus);
  const localStatusChanged = isAfter(input.localStatusUpdatedAt, input.lastSyncedAt);
  const localProgressChanged = isAfter(input.localProgressUpdatedAt, input.lastSyncedAt);
  const remoteChanged = isAfter(input.remoteUpdatedAt, input.lastSyncedAt);
  const statusDiffers = localStatus !== remoteStatus;
  const progressDiffers = input.localProgress !== remoteProgress;

  if (!statusDiffers && !progressDiffers) {
    return {
      direction: "merge",
      status: remoteStatus,
      progress: remoteProgress,
      hasConflict: false,
    };
  }

  if ((localStatusChanged || localProgressChanged) && !remoteChanged) {
    return {
      direction: "push",
      status: localStatus,
      progress: input.localProgress,
      hasConflict: false,
    };
  }

  if (remoteChanged && !localStatusChanged && !localProgressChanged) {
    return {
      direction: "pull",
      status: remoteStatus,
      progress: remoteProgress,
      hasConflict: false,
    };
  }

  const chooseRemoteStatus =
    input.remoteUpdatedAt &&
    input.localStatusUpdatedAt &&
    input.remoteUpdatedAt.getTime() > input.localStatusUpdatedAt.getTime();
  const chooseRemoteProgress =
    input.remoteUpdatedAt &&
    input.localProgressUpdatedAt &&
    input.remoteUpdatedAt.getTime() > input.localProgressUpdatedAt.getTime();

  return {
    direction: "merge",
    status: chooseRemoteStatus ? remoteStatus : localStatus,
    progress: chooseRemoteProgress ? remoteProgress : Math.max(input.localProgress, remoteProgress),
    hasConflict: statusDiffers || progressDiffers,
  };
}

export function getAniListConnectUrl(state: string) {
  if (!isAniListConfigured()) {
    throw new Error("AniList sync is not configured");
  }

  return createAniListAuthorizeUrl(state);
}

export async function connectAniListAccount(code: string) {
  const token = await exchangeAniListCode(code);
  const viewer = await getAniListViewer(token.access_token);
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);

  getDb().delete(anilistAccount).run();
  getDb()
    .insert(anilistAccount)
    .values({
      id: crypto.randomUUID(),
      accessToken: encryptStoredSecret(token.access_token),
      tokenType: token.token_type,
      expiresAt,
      viewerId: viewer.id,
      viewerName: viewer.name,
      createdAt: nowDate(),
      updatedAt: nowDate(),
    })
    .run();

  logSync("import", "success", `Connected AniList account ${viewer.name}.`);
  return viewer;
}

export function disconnectAniListAccount() {
  getDb().delete(anilistAccount).run();
  logSync("pull", "success", "Disconnected AniList account.");
}

export function getAniListSyncOverview(): AniListSyncOverview {
  const account = getAccountRecord();
  const lastSync = getDb()
    .select({ lastSyncedAt: anilistSync.lastSyncedAt })
    .from(anilistSync)
    .orderBy(desc(anilistSync.lastSyncedAt))
    .get();
  const linkedSeriesCount = getDb().select({ value: count() }).from(anilistSync).get()?.value ?? 0;
  const recentLogs = getDb()
    .select()
    .from(syncLog)
    .orderBy(desc(syncLog.createdAt))
    .limit(6)
    .all()
    .map((item) => ({
      id: item.id,
      direction: item.direction,
      status: item.status,
      details: item.details,
      createdAt: toIsoString(item.createdAt),
    }));

  return {
    configured: isAniListConfigured(),
    connected: Boolean(account),
    viewerName: account?.viewerName ?? null,
    expiresAt: toIsoString(account?.expiresAt),
    lastSyncAt: toIsoString(lastSync?.lastSyncedAt),
    linkedSeriesCount,
    recentLogs,
  };
}

export function getSeriesAniListSyncStatus(sourceSeriesId: string): AniListSeriesSyncStatus {
  const account = getAccountRecord();
  const row = getDb()
    .select({
      anilistId: series.anilistId,
      syncState: anilistSync.syncState,
      lastDirection: anilistSync.lastDirection,
      lastSyncedAt: anilistSync.lastSyncedAt,
      remoteStatus: anilistSync.remoteStatus,
      remoteProgress: anilistSync.remoteProgress,
      lastError: anilistSync.lastError,
    })
    .from(sourceMapping)
    .innerJoin(series, eq(series.id, sourceMapping.seriesId))
    .leftJoin(anilistSync, eq(anilistSync.seriesId, series.id))
    .where(and(eq(sourceMapping.source, SOURCE), eq(sourceMapping.sourceSeriesId, sourceSeriesId)))
    .get();

  return {
    configured: isAniListConfigured(),
    connected: Boolean(account),
    linked: Boolean(row?.anilistId),
    anilistId: row?.anilistId ?? null,
    syncState: row?.syncState ?? null,
    lastDirection: row?.lastDirection ?? null,
    lastSyncedAt: toIsoString(row?.lastSyncedAt),
    remoteStatus: (row?.remoteStatus as AniListRemoteStatus | null | undefined) ?? null,
    remoteProgress: row?.remoteProgress ?? null,
    lastError: row?.lastError ?? null,
  };
}

export async function importAniListLibrary() {
  const account = requireAccount();
  const entries = await getAniListMangaLibrary(account.accessToken, account.viewerName ?? undefined);
  let imported = 0;
  let skipped = 0;

  for (const entry of entries) {
    const existing = findLocalSeriesForRemoteEntry(entry);

    if (existing) {
      ensureLibraryEntry(existing.id, mapAniListStatusToLocal(entry.status));
      upsertSyncRecord({
        seriesId: existing.id,
        anilistId: entry.media.id,
        mediaListEntryId: entry.id,
        syncState: "success",
        lastDirection: "import",
        remoteStatus: entry.status,
        remoteProgress: entry.progress,
        remoteUpdatedAt: toRemoteUpdatedAt(entry.updatedAt),
      });

      if ((entry.progress ?? 0) > 0) {
        applyRemoteProgress(existing.id, entry.progress ?? 0);
      }

      imported += 1;
      continue;
    }

    const preferredTitle =
      entry.media.title.userPreferred ??
      entry.media.title.english ??
      entry.media.title.romaji ??
      entry.media.title.native;

    if (!preferredTitle) {
      skipped += 1;
      continue;
    }

    const searchResults = await getSeriesDetailFromAniListMatch(preferredTitle);
    if (!searchResults) {
      skipped += 1;
      continue;
    }

    const seriesId = await ensureSeriesRecord(searchResults.sourceId, searchResults.detail);
    const chapters = await getChapterList(searchResults.sourceId);
    ensureChapterCatalog(seriesId, chapters);

    getDb()
      .update(series)
      .set({
        anilistId: entry.media.id,
        updatedAt: nowDate(),
      })
      .where(eq(series.id, seriesId))
      .run();

    ensureLibraryEntry(seriesId, mapAniListStatusToLocal(entry.status));
    upsertSyncRecord({
      seriesId,
      anilistId: entry.media.id,
      mediaListEntryId: entry.id,
      syncState: "success",
      lastDirection: "import",
      remoteStatus: entry.status,
      remoteProgress: entry.progress,
      remoteUpdatedAt: toRemoteUpdatedAt(entry.updatedAt),
    });

    if ((entry.progress ?? 0) > 0) {
      applyRemoteProgress(seriesId, entry.progress ?? 0);
    }

    imported += 1;
  }

  logSync("import", "success", `Imported ${imported} AniList entries; skipped ${skipped}.`);
  return { imported, skipped, pushed: 0, pulled: 0, conflicts: 0 } satisfies AniListSyncRunResult;
}

async function getSeriesDetailFromAniListMatch(title: string) {
  const results = await search(title);
  const exactMatch =
    results.find((result) => normalizeTitle(result.title) === normalizeTitle(title)) ?? results[0] ?? null;

  if (!exactMatch) {
    return null;
  }

  return {
    sourceId: exactMatch.sourceId,
    detail: await getSeriesDetail(exactMatch.sourceId),
  };
}

export async function scrobbleSeriesToAniList(seriesId: string): Promise<void> {
  if (!isAniListConfigured()) return;

  const account = getAccountRecord();
  if (!account) return;
  if (account.expiresAt && account.expiresAt.getTime() < Date.now()) return;

  const row = getDb()
    .select({
      anilistId: series.anilistId,
      status: libraryEntry.status,
    })
    .from(series)
    .leftJoin(libraryEntry, eq(libraryEntry.seriesId, series.id))
    .where(eq(series.id, seriesId))
    .get();

  if (!row?.anilistId) return;

  const existingSync = getDb()
    .select()
    .from(anilistSync)
    .where(eq(anilistSync.seriesId, seriesId))
    .get();
  const localProgress = getLocalProgressForSeries(seriesId);
  const localStatus = mapLocalStatusToAniList(row.status ?? "planning");

  if (
    existingSync?.remoteProgress === localProgress.progress &&
    existingSync?.remoteStatus === localStatus
  ) {
    return;
  }

  try {
    const saved = await saveAniListMediaListEntry({
      accessToken: account.accessToken,
      mediaId: row.anilistId,
      status: localStatus,
      progress: localProgress.progress,
      entryId: existingSync?.mediaListEntryId ?? null,
    });
    upsertSyncRecord({
      seriesId,
      anilistId: row.anilistId,
      mediaListEntryId: saved.id,
      syncState: "success",
      lastDirection: "push",
      remoteStatus: saved.status,
      remoteProgress: saved.progress,
      remoteUpdatedAt: toRemoteUpdatedAt(saved.updatedAt),
    });
    logSync(
      "push",
      "success",
      `Auto-scrobbled chapter completion (progress ${localProgress.progress}) to AniList.`,
      seriesId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    upsertSyncRecord({
      seriesId,
      anilistId: row.anilistId,
      mediaListEntryId: existingSync?.mediaListEntryId ?? null,
      syncState: "error",
      lastDirection: "push",
      remoteStatus: existingSync?.remoteStatus ?? null,
      remoteProgress: existingSync?.remoteProgress ?? null,
      remoteUpdatedAt: existingSync?.remoteUpdatedAt ?? null,
      lastError: message,
    });
    logSync("push", "error", `Auto-scrobble failed: ${message}`, seriesId);
  }
}

export async function syncAniListLibrary() {
  const account = requireAccount();
  const remoteEntries = await getAniListMangaLibrary(account.accessToken, account.viewerName ?? undefined);
  const remoteByAniListId = new Map(remoteEntries.map((entry) => [entry.media.id, entry]));
  const localRows = getDb()
    .select({
      seriesId: series.id,
      anilistId: series.anilistId,
      status: libraryEntry.status,
      statusUpdatedAt: libraryEntry.updatedAt,
    })
    .from(libraryEntry)
    .innerJoin(series, eq(series.id, libraryEntry.seriesId))
    .all()
    .filter((row) => row.anilistId !== null && row.status === "reading");

  let pushed = 0;
  let pulled = 0;
  let conflicts = 0;

  for (const row of localRows) {
    const remoteEntry = remoteByAniListId.get(row.anilistId as number) ?? null;
    const existingSync = getDb()
      .select()
      .from(anilistSync)
      .where(eq(anilistSync.seriesId, row.seriesId))
      .get();
    const localProgress = getLocalProgressForSeries(row.seriesId);

    if (!remoteEntry) {
      const saved = await saveAniListMediaListEntry({
        accessToken: account.accessToken,
        mediaId: row.anilistId as number,
        status: mapLocalStatusToAniList(row.status),
        progress: localProgress.progress,
        entryId: existingSync?.mediaListEntryId ?? null,
      });

      upsertSyncRecord({
        seriesId: row.seriesId,
        anilistId: row.anilistId as number,
        mediaListEntryId: saved.id,
        syncState: "success",
        lastDirection: "push",
        remoteStatus: saved.status,
        remoteProgress: saved.progress,
        remoteUpdatedAt: toRemoteUpdatedAt(saved.updatedAt),
      });
      logSync("push", "success", "Created AniList list entry from local library state.", row.seriesId);
      pushed += 1;
      continue;
    }

    const decision = resolveAniListSyncDecision({
      localStatus: row.status,
      localStatusUpdatedAt: row.statusUpdatedAt,
      localProgress: localProgress.progress,
      localProgressUpdatedAt: localProgress.updatedAt,
      remoteStatus: remoteEntry.status,
      remoteProgress: remoteEntry.progress,
      remoteUpdatedAt: toRemoteUpdatedAt(remoteEntry.updatedAt),
      lastSyncedAt: existingSync?.lastSyncedAt ?? null,
    });

    if (decision.direction === "push") {
      const saved = await saveAniListMediaListEntry({
        accessToken: account.accessToken,
        mediaId: row.anilistId as number,
        status: decision.status,
        progress: decision.progress,
        entryId: remoteEntry.id,
      });

      upsertSyncRecord({
        seriesId: row.seriesId,
        anilistId: row.anilistId as number,
        mediaListEntryId: saved.id,
        syncState: "success",
        lastDirection: "push",
        remoteStatus: saved.status,
        remoteProgress: saved.progress,
        remoteUpdatedAt: toRemoteUpdatedAt(saved.updatedAt),
      });
      logSync("push", "success", "Pushed local library state to AniList.", row.seriesId);
      pushed += 1;
      continue;
    }

    if (decision.direction === "pull") {
      ensureLibraryEntry(row.seriesId, mapAniListStatusToLocal(decision.status));
      applyRemoteProgress(row.seriesId, decision.progress);
      upsertSyncRecord({
        seriesId: row.seriesId,
        anilistId: row.anilistId as number,
        mediaListEntryId: remoteEntry.id,
        syncState: "success",
        lastDirection: "pull",
        remoteStatus: remoteEntry.status,
        remoteProgress: remoteEntry.progress,
        remoteUpdatedAt: toRemoteUpdatedAt(remoteEntry.updatedAt),
      });
      logSync("pull", "success", "Pulled AniList state into the local library.", row.seriesId);
      pulled += 1;
      continue;
    }

    const saved = await saveAniListMediaListEntry({
      accessToken: account.accessToken,
      mediaId: row.anilistId as number,
      status: decision.status,
      progress: decision.progress,
      entryId: remoteEntry.id,
    });

    ensureLibraryEntry(row.seriesId, mapAniListStatusToLocal(decision.status));
    applyRemoteProgress(row.seriesId, decision.progress);
    upsertSyncRecord({
      seriesId: row.seriesId,
      anilistId: row.anilistId as number,
      mediaListEntryId: saved.id,
      syncState: decision.hasConflict ? "conflict" : "success",
      lastDirection: "merge",
      remoteStatus: saved.status,
      remoteProgress: saved.progress,
      remoteUpdatedAt: toRemoteUpdatedAt(saved.updatedAt),
      lastError: decision.hasConflict ? "Merged divergent local and remote progress." : null,
    });
    logSync(
      "merge",
      decision.hasConflict ? "conflict" : "success",
      decision.hasConflict
        ? "Merged conflicting AniList and local progress using the most recent change and higher progress."
        : "Merged AniList and local state.",
      row.seriesId,
    );
    conflicts += decision.hasConflict ? 1 : 0;
  }

  return {
    imported: 0,
    skipped: 0,
    pushed,
    pulled,
    conflicts,
  } satisfies AniListSyncRunResult;
}
