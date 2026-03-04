"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Loader2,
  BookOpen,
  Clock,
  User,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SeriesDetail, Chapter } from "@/lib/sources/types";
import type { LibraryStatus } from "@/lib/library/state";

interface LibraryCollectionRecord {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  createdAt: string | null;
  seriesCount: number;
}

type LibraryTagType = "mood" | "genre" | "theme" | "custom";

interface LibraryTagRecord {
  id: string;
  name: string;
  color: string | null;
  type: LibraryTagType;
  seriesCount: number;
}

interface AniListSeriesSyncStatus {
  configured: boolean;
  connected: boolean;
  linked: boolean;
  anilistId: number | null;
  syncState: "idle" | "running" | "success" | "error" | "conflict" | null;
  lastDirection: "import" | "push" | "pull" | "merge" | null;
  lastSyncedAt: string | null;
  remoteStatus: string | null;
  remoteProgress: number | null;
  lastError: string | null;
}

const TAG_TYPE_LABELS: Record<LibraryTagType, string> = {
  mood: "Mood",
  genre: "Genre",
  theme: "Theme",
  custom: "Custom",
};

const STATUS_COLORS: Record<string, string> = {
  Ongoing: "text-reading",
  Complete: "text-completed",
  Hiatus: "text-paused",
  Canceled: "text-dropped",
};

export function SeriesView({ sourceId }: { sourceId: string }) {
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [chaptersLoading, setChaptersLoading] = useState(true);
  const [descExpanded, setDescExpanded] = useState(false);
  const [chaptersReversed, setChaptersReversed] = useState(false);
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus>("planning");
  const [libraryEntryStatus, setLibraryEntryStatus] = useState<LibraryStatus | null>(null);
  const [librarySaving, setLibrarySaving] = useState(false);
  const [collections, setCollections] = useState<LibraryCollectionRecord[]>([]);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  const [collectionsSaving, setCollectionsSaving] = useState(false);
  const [tags, setTags] = useState<LibraryTagRecord[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagsSaving, setTagsSaving] = useState(false);
  const [aniListSync, setAniListSync] = useState<AniListSeriesSyncStatus | null>(null);

  const statusOptions: Array<{ value: LibraryStatus; label: string }> = [
    { value: "reading", label: "Reading" },
    { value: "planning", label: "Planning" },
    { value: "completed", label: "Completed" },
    { value: "paused", label: "Paused" },
    { value: "rereading", label: "Rereading" },
    { value: "dropped", label: "Dropped" },
  ];

  useEffect(() => {
    async function load() {
      try {
        const [seriesRes, chaptersRes, libraryRes, collectionsRes, seriesCollectionsRes, tagsRes, seriesTagsRes, aniListSyncRes] = await Promise.all([
          fetch(`/api/series/${sourceId}`),
          fetch(`/api/series/${sourceId}/chapters`),
          fetch(`/api/library/${sourceId}`),
          fetch("/api/collections"),
          fetch(`/api/collections/series/${sourceId}`),
          fetch("/api/tags"),
          fetch(`/api/tags/series/${sourceId}`),
          fetch(`/api/anilist/series/${sourceId}`),
        ]);

        if (seriesRes.ok) {
          setSeries(await seriesRes.json());
        }
        setLoading(false);

        if (chaptersRes.ok) {
          setChapters(await chaptersRes.json());
        }
        setChaptersLoading(false);

        if (libraryRes.ok) {
          const entry = (await libraryRes.json()) as { status: LibraryStatus };
          setLibraryEntryStatus(entry.status);
          setLibraryStatus(entry.status);
        }

        if (collectionsRes.ok) {
          setCollections((await collectionsRes.json()) as LibraryCollectionRecord[]);
        }

        if (seriesCollectionsRes.ok) {
          const membership = (await seriesCollectionsRes.json()) as { collectionIds: string[] };
          setSelectedCollectionIds(membership.collectionIds);
        }

        if (tagsRes.ok) {
          setTags((await tagsRes.json()) as LibraryTagRecord[]);
        }

        if (seriesTagsRes.ok) {
          const membership = (await seriesTagsRes.json()) as { tagIds: string[] };
          setSelectedTagIds(membership.tagIds);
        }

        if (aniListSyncRes.ok) {
          setAniListSync((await aniListSyncRes.json()) as AniListSeriesSyncStatus);
        }
      } catch {
        setLoading(false);
        setChaptersLoading(false);
      }
    }

    void load();
  }, [sourceId]);

  async function handleLibrarySave() {
    if (!series) {
      return;
    }

    setLibrarySaving(true);

    try {
      const response = await fetch("/api/library", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          seriesId: sourceId,
          status: libraryStatus,
          series,
          chapters,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save library entry");
      }

      const entry = (await response.json()) as { status: LibraryStatus };
      setLibraryEntryStatus(entry.status);
      setLibraryStatus(entry.status);
    } finally {
      setLibrarySaving(false);
    }
  }

  async function handleCollectionToggle(collectionId: string, checked: boolean) {
    if (!series) {
      return;
    }

    const nextCollectionIds = checked
      ? [...new Set([...selectedCollectionIds, collectionId])]
      : selectedCollectionIds.filter((id) => id !== collectionId);

    setSelectedCollectionIds(nextCollectionIds);
    setCollectionsSaving(true);

    try {
      const response = await fetch(`/api/collections/series/${sourceId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          collectionIds: nextCollectionIds,
          series,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save collection membership");
      }

      const payload = (await response.json()) as { collectionIds: string[] };
      setSelectedCollectionIds(payload.collectionIds);
    } finally {
      setCollectionsSaving(false);
    }
  }

  async function handleTagToggle(tagId: string, checked: boolean) {
    if (!series) {
      return;
    }

    const nextTagIds = checked
      ? [...new Set([...selectedTagIds, tagId])]
      : selectedTagIds.filter((id) => id !== tagId);

    setSelectedTagIds(nextTagIds);
    setTagsSaving(true);

    try {
      const response = await fetch(`/api/tags/series/${sourceId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tagIds: nextTagIds,
          series,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save tags");
      }

      const payload = (await response.json()) as { tagIds: string[] };
      setSelectedTagIds(payload.tagIds);
    } finally {
      setTagsSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (!series) {
    return (
      <div className="py-32 text-center text-text-muted">
        Series not found.
      </div>
    );
  }

  const displayedChapters = chaptersReversed
    ? [...chapters].reverse()
    : chapters;

  return (
    <div className="space-y-8">
      {/* ── Hero ── */}
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="relative aspect-[2/3] w-48 shrink-0 self-start overflow-hidden rounded-xl bg-surface-raised">
          <Image
            src={`/api/media/cover/${sourceId}`}
            alt={series.title}
            fill
            sizes="192px"
            className="object-cover"
            priority
          />
        </div>

        <div className="flex-1 space-y-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text">
              {series.title}
            </h1>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              {series.status && (
                <span
                  className={cn(
                    "font-medium",
                    STATUS_COLORS[series.status] || "text-text-muted"
                  )}
                >
                  {series.status}
                </span>
              )}
              {series.type && (
                <Badge variant="accent">{series.type}</Badge>
              )}
              {series.year && (
                <span className="flex items-center gap-1 text-text-faint">
                  <Clock className="h-3.5 w-3.5" />
                  {series.year}
                </span>
              )}
            </div>
          </div>

          {series.authors.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <User className="h-4 w-4 shrink-0 text-text-faint" />
              <span>{series.authors.join(", ")}</span>
            </div>
          )}

          {series.description && (
            <div className="relative">
              <p
                className={cn(
                  "text-sm leading-relaxed text-text-muted",
                  !descExpanded && "line-clamp-4"
                )}
              >
                {series.description}
              </p>
              {series.description.length > 200 && (
                <button
                  onClick={() => setDescExpanded(!descExpanded)}
                  className="mt-1 text-xs font-medium text-accent hover:text-accent-muted"
                >
                  {descExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}

          {series.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {series.tags.map((tag) => (
                <Badge key={tag} variant="default">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {series.anilistUrl && (
            <a
              href={series.anilistUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-text-faint transition-colors hover:text-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              AniList
            </a>
          )}

          {aniListSync?.connected && (
            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-faint">
                    Sync Status
                  </p>
                  <p className="mt-1 text-sm text-text-muted">
                    {aniListSync.linked
                      ? `Remote ${aniListSync.remoteStatus?.toLowerCase() ?? "planning"}, progress ${aniListSync.remoteProgress ?? 0}.`
                      : "This series is not linked to AniList yet."}
                  </p>
                </div>
                <span className="rounded-full border border-border bg-surface-raised px-2.5 py-1 text-xs uppercase tracking-[0.18em] text-text-faint">
                  {aniListSync.syncState ?? "idle"}
                </span>
              </div>
              {(aniListSync.lastSyncedAt || aniListSync.lastError) && (
                <div className="mt-2 space-y-1 text-xs text-text-faint">
                  {aniListSync.lastSyncedAt && <p>Last synced {new Date(aniListSync.lastSyncedAt).toLocaleString()}.</p>}
                  {aniListSync.lastDirection && <p>Last action: {aniListSync.lastDirection}.</p>}
                  {aniListSync.lastError && <p className="text-dropped">{aniListSync.lastError}</p>}
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-faint">
                  Library
                </p>
                <select
                  value={libraryStatus}
                  onChange={(event) => setLibraryStatus(event.target.value as LibraryStatus)}
                  className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
                  aria-label="Library status"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => void handleLibrarySave()}
                disabled={librarySaving}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-void transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-70"
              >
                {librarySaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {libraryEntryStatus ? "Update library status" : "Add to library"}
              </button>
            </div>

            <p className="mt-3 text-xs text-text-faint">
              {libraryEntryStatus
                ? `Saved in your library as ${statusOptions.find((option) => option.value === libraryEntryStatus)?.label}.`
                : "Save this series with a status so it shows up on your shelves."}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-faint">
                Collections
              </p>
              {collectionsSaving && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
            </div>

            {collections.length > 0 ? (
              <div className="mt-3 space-y-2">
                {collections.map((collection) => (
                  <label
                    key={collection.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-surface-raised px-3 py-2.5 text-sm text-text"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{collection.name}</span>
                      {collection.description && (
                        <span className="block truncate text-xs text-text-faint">
                          {collection.description}
                        </span>
                      )}
                    </span>
                    <input
                      type="checkbox"
                      checked={selectedCollectionIds.includes(collection.id)}
                      onChange={(event) =>
                        void handleCollectionToggle(collection.id, event.target.checked)
                      }
                      className="h-4 w-4 rounded border-border bg-surface text-accent focus:ring-accent"
                      aria-label={`Add to ${collection.name}`}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-text-faint">
                Create a collection from the library page to start organizing custom shelves.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-faint">
                Personal tags
              </p>
              {tagsSaving && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
            </div>

            {tags.length > 0 ? (
              <div className="mt-3 space-y-2">
                {tags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-surface-raised px-3 py-2.5 text-sm text-text"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-medium">
                        <span
                          className="h-3 w-3 rounded-full border border-black/10"
                          style={{ backgroundColor: tag.color ?? "#6b7280" }}
                          aria-hidden="true"
                        />
                        {tag.name}
                      </span>
                      <span className="block truncate text-xs text-text-faint">
                        {TAG_TYPE_LABELS[tag.type]}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={selectedTagIds.includes(tag.id)}
                      onChange={(event) => void handleTagToggle(tag.id, event.target.checked)}
                      className="h-4 w-4 rounded border-border bg-surface text-accent focus:ring-accent"
                      aria-label={`Add tag ${tag.name}`}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-text-faint">
                Create tags from the library page to add your own taxonomy to this series.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Chapters ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text">
            <BookOpen className="h-5 w-5 text-text-faint" />
            Chapters
            {!chaptersLoading && (
              <span className="text-sm font-normal text-text-faint">
                ({chapters.length})
              </span>
            )}
          </h2>

          <button
            onClick={() => setChaptersReversed(!chaptersReversed)}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
          >
            {chaptersReversed ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {chaptersReversed ? "Oldest first" : "Newest first"}
          </button>
        </div>

        {chaptersLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          </div>
        ) : chapters.length === 0 ? (
          <p className="py-12 text-center text-sm text-text-faint">
            No chapters available.
          </p>
        ) : (
          <div className="space-y-1">
            {displayedChapters.map((ch) => (
              <Link
                key={ch.sourceChapterId}
                href={`/read/${sourceId}/${ch.sourceChapterId}`}
                className="flex items-center justify-between rounded-lg border border-transparent px-4 py-3 text-sm transition-colors hover:border-border hover:bg-surface-raised"
              >
                <span className="font-medium text-text">{ch.title}</span>
                <BookOpen className="h-4 w-4 text-text-faint" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
