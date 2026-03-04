"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Clock3, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { SeriesCard } from "@/components/series-card";
import type { LibraryStatus } from "@/lib/library/state";
import { deriveLibraryInsights } from "@/lib/library/insights";

interface LibraryEntryRecord {
  sourceSeriesId: string;
  title: string;
  coverUrl: string | null;
  status: LibraryStatus;
  addedAt: string | null;
  updatedAt: string | null;
  currentPage: number | null;
  progressUpdatedAt: string | null;
  currentChapterSourceId: string | null;
  currentChapterTitle: string | null;
  totalChapters: number;
  completedChapters: number;
  unreadChapters: number;
  lastCompletedAt: string | null;
  lastCompletedChapterSourceId: string | null;
  lastCompletedChapterTitle: string | null;
  collectionIds: string[];
  tagIds: string[];
}

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

interface AniListSyncOverview {
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

const TAG_TYPE_LABELS: Record<LibraryTagType, string> = {
  mood: "Mood",
  genre: "Genre",
  theme: "Theme",
  custom: "Custom",
};

const STATUS_LABELS: Record<LibraryStatus, string> = {
  reading: "Reading",
  completed: "Completed",
  paused: "Paused",
  dropped: "Dropped",
  rereading: "Rereading",
  planning: "Planning",
};

const STATUS_ORDER: LibraryStatus[] = [
  "reading",
  "rereading",
  "planning",
  "paused",
  "completed",
  "dropped",
];

type SortMode = "updated" | "added" | "title" | "unread";

function formatRelativeDate(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function LibraryView() {
  const [entries, setEntries] = useState<LibraryEntryRecord[]>([]);
  const [collections, setCollections] = useState<LibraryCollectionRecord[]>([]);
  const [tags, setTags] = useState<LibraryTagRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [collectionName, setCollectionName] = useState("");
  const [collectionDescription, setCollectionDescription] = useState("");
  const [savingCollection, setSavingCollection] = useState(false);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#d97706");
  const [tagType, setTagType] = useState<LibraryTagType>("custom");
  const [savingTag, setSavingTag] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState("");
  const [editingTagColor, setEditingTagColor] = useState("#d97706");
  const [editingTagType, setEditingTagType] = useState<LibraryTagType>("custom");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<LibraryStatus | "all">("all");
  const [collectionFilter, setCollectionFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [aniList, setAniList] = useState<AniListSyncOverview | null>(null);
  const [aniListBusy, setAniListBusy] = useState<"import" | "sync" | "disconnect" | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [libraryResponse, collectionResponse, tagResponse, aniListResponse] = await Promise.all([
          fetch("/api/library"),
          fetch("/api/collections"),
          fetch("/api/tags"),
          fetch("/api/anilist/status"),
        ]);
        const data = libraryResponse.ok ? ((await libraryResponse.json()) as LibraryEntryRecord[]) : [];
        const nextCollections = collectionResponse.ok
          ? ((await collectionResponse.json()) as LibraryCollectionRecord[])
          : [];
        const nextTags = tagResponse.ok ? ((await tagResponse.json()) as LibraryTagRecord[]) : [];
        const nextAniList = aniListResponse.ok
          ? ((await aniListResponse.json()) as AniListSyncOverview)
          : null;

        if (!cancelled) {
          setEntries(data);
          setCollections(nextCollections);
          setTags(nextTags);
          setAniList(nextAniList);
        }
      } catch {
        if (!cancelled) {
          setEntries([]);
          setCollections([]);
          setTags([]);
          setAniList(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const nextEntries = entries.filter((entry) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        entry.title.toLowerCase().includes(normalizedQuery) ||
        (entry.currentChapterTitle?.toLowerCase().includes(normalizedQuery) ?? false);
      const matchesStatus = statusFilter === "all" || entry.status === statusFilter;
      const matchesCollection =
        collectionFilter === "all" || entry.collectionIds.includes(collectionFilter);
      const matchesTag = tagFilter === "all" || entry.tagIds.includes(tagFilter);

      return matchesQuery && matchesStatus && matchesCollection && matchesTag;
    });

    return [...nextEntries].sort((left, right) => {
      if (sortMode === "title") {
        return left.title.localeCompare(right.title);
      }

      if (sortMode === "unread") {
        return right.unreadChapters - left.unreadChapters || left.title.localeCompare(right.title);
      }

      const leftValue =
        sortMode === "added"
          ? (left.addedAt ? new Date(left.addedAt).getTime() : 0)
          : (left.updatedAt ? new Date(left.updatedAt).getTime() : 0);
      const rightValue =
        sortMode === "added"
          ? (right.addedAt ? new Date(right.addedAt).getTime() : 0)
          : (right.updatedAt ? new Date(right.updatedAt).getTime() : 0);

      return rightValue - leftValue;
    });
  }, [collectionFilter, entries, query, sortMode, statusFilter, tagFilter]);

  const hasActiveFilters = useMemo(
    () =>
      query.trim().length > 0 ||
      statusFilter !== "all" ||
      collectionFilter !== "all" ||
      tagFilter !== "all" ||
      sortMode !== "updated",
    [collectionFilter, query, sortMode, statusFilter, tagFilter],
  );

  const continueReading = useMemo(
    () =>
      filteredEntries
        .filter((entry) => entry.currentChapterSourceId && entry.progressUpdatedAt)
        .sort((left, right) => {
          const leftTime = left.progressUpdatedAt ? new Date(left.progressUpdatedAt).getTime() : 0;
          const rightTime = right.progressUpdatedAt ? new Date(right.progressUpdatedAt).getTime() : 0;
          return rightTime - leftTime;
        })
        .slice(0, 6),
    [filteredEntries],
  );

  const recentlyAdded = useMemo(
    () =>
      [...filteredEntries]
        .sort((left, right) => {
          const leftTime = left.addedAt ? new Date(left.addedAt).getTime() : 0;
          const rightTime = right.addedAt ? new Date(right.addedAt).getTime() : 0;
          return rightTime - leftTime;
        })
        .slice(0, 6),
    [filteredEntries],
  );

  const entriesByStatus = useMemo(
    () =>
      STATUS_ORDER.map((status) => ({
        status,
        label: STATUS_LABELS[status],
        entries: filteredEntries.filter((entry) => entry.status === status),
      })).filter((group) => group.entries.length > 0),
    [filteredEntries],
  );

  const insights = useMemo(() => deriveLibraryInsights(filteredEntries), [filteredEntries]);

  async function refreshAniListStatus() {
    const response = await fetch("/api/anilist/status");

    if (!response.ok) {
      throw new Error("Failed to load AniList status");
    }

    setAniList((await response.json()) as AniListSyncOverview);
  }

  async function handleAniListAction(action: "import" | "sync" | "disconnect") {
    setAniListBusy(action);

    try {
      const response = await fetch(
        action === "disconnect" ? "/api/anilist/status" : `/api/anilist/${action}`,
        { method: action === "disconnect" ? "DELETE" : "POST" },
      );

      if (!response.ok) {
        throw new Error(`Failed to ${action} AniList state`);
      }

      await refreshAniListStatus();
    } finally {
      setAniListBusy(null);
    }
  }

  async function handleCreateCollection(event: React.FormEvent) {
    event.preventDefault();
    if (!collectionName.trim()) {
      return;
    }

    setSavingCollection(true);

    try {
      const response = await fetch("/api/collections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: collectionName,
          description: collectionDescription,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create collection");
      }

      const nextCollection = (await response.json()) as LibraryCollectionRecord;
      setCollections((current) => [...current, nextCollection].sort((left, right) => left.sortOrder - right.sortOrder));
      setCollectionName("");
      setCollectionDescription("");
    } finally {
      setSavingCollection(false);
    }
  }

  function startEditingCollection(collection: LibraryCollectionRecord) {
    setEditingCollectionId(collection.id);
    setEditingName(collection.name);
    setEditingDescription(collection.description ?? "");
  }

  async function handleUpdateCollection(collectionId: string) {
    if (!editingName.trim()) {
      return;
    }

    setSavingCollection(true);

    try {
      const response = await fetch(`/api/collections/${collectionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editingName,
          description: editingDescription,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update collection");
      }

      const nextCollection = (await response.json()) as LibraryCollectionRecord;
      setCollections((current) =>
        current.map((collection) => (collection.id === collectionId ? nextCollection : collection)),
      );
      setEditingCollectionId(null);
      setEditingName("");
      setEditingDescription("");
    } finally {
      setSavingCollection(false);
    }
  }

  async function handleDeleteCollection(collectionId: string) {
    setSavingCollection(true);

    try {
      const response = await fetch(`/api/collections/${collectionId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete collection");
      }

      setCollections((current) => current.filter((collection) => collection.id !== collectionId));
    } finally {
      setSavingCollection(false);
    }
  }

  async function handleCreateTag(event: React.FormEvent) {
    event.preventDefault();
    if (!tagName.trim()) {
      return;
    }

    setSavingTag(true);

    try {
      const response = await fetch("/api/tags", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: tagName,
          color: tagColor,
          type: tagType,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create tag");
      }

      const nextTag = (await response.json()) as LibraryTagRecord;
      setTags((current) => [...current, nextTag].sort((left, right) => left.name.localeCompare(right.name)));
      setTagName("");
      setTagColor("#d97706");
      setTagType("custom");
    } finally {
      setSavingTag(false);
    }
  }

  function startEditingTag(tag: LibraryTagRecord) {
    setEditingTagId(tag.id);
    setEditingTagName(tag.name);
    setEditingTagColor(tag.color ?? "#d97706");
    setEditingTagType(tag.type);
  }

  async function handleUpdateTag(tagId: string) {
    if (!editingTagName.trim()) {
      return;
    }

    setSavingTag(true);

    try {
      const response = await fetch(`/api/tags/${tagId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editingTagName,
          color: editingTagColor,
          type: editingTagType,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update tag");
      }

      const nextTag = (await response.json()) as LibraryTagRecord;
      setTags((current) => current.map((tag) => (tag.id === tagId ? nextTag : tag)));
      setEditingTagId(null);
      setEditingTagName("");
      setEditingTagColor("#d97706");
      setEditingTagType("custom");
    } finally {
      setSavingTag(false);
    }
  }

  async function handleDeleteTag(tagId: string) {
    setSavingTag(true);

    try {
      const response = await fetch(`/api/tags/${tagId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete tag");
      }

      setTags((current) => current.filter((tag) => tag.id !== tagId));
    } finally {
      setSavingTag(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Your Library</h1>
        <p className="text-sm text-text-muted">
          Continue where you left off, revisit recent additions, and browse by status.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-faint">
              AniList Sync
            </p>
            <h2 className="text-lg font-semibold text-text">
              {aniList?.connected
                ? `Connected as ${aniList.viewerName ?? "AniList user"}`
                : "Keep your private library in sync"}
            </h2>
            <p className="max-w-2xl text-sm text-text-muted">
              {aniList?.configured
                ? "Import AniList entries, sync status changes both ways, and reconcile chapter progress using the most recent update."
                : "Set ANILIST_CLIENT_ID, ANILIST_CLIENT_SECRET, and ANILIST_REDIRECT_URI to enable AniList sync."}
            </p>
            {aniList?.lastSyncAt && (
              <p className="text-xs text-text-faint">
                Last sync: {formatRelativeDate(aniList.lastSyncAt)}. Linked series: {aniList.linkedSeriesCount}.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {!aniList?.connected ? (
              <button
                type="button"
                disabled={!aniList?.configured}
                onClick={() => {
                  window.location.href = "/api/anilist/connect";
                }}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-void transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                Connect AniList
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={aniListBusy !== null}
                  onClick={() => void handleAniListAction("import")}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-void transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {aniListBusy === "import" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Import library
                </button>
                <button
                  type="button"
                  disabled={aniListBusy !== null}
                  onClick={() => void handleAniListAction("sync")}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised px-4 py-2.5 text-sm font-medium text-text transition-colors hover:border-accent-muted hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {aniListBusy === "sync" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Run sync
                </button>
                <button
                  type="button"
                  disabled={aniListBusy !== null}
                  onClick={() => void handleAniListAction("disconnect")}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-raised px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:border-dropped hover:text-dropped disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {aniListBusy === "disconnect" && <Loader2 className="h-4 w-4 animate-spin" />}
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>

        {aniList?.recentLogs.length ? (
          <div className="mt-4 grid gap-2">
            {aniList.recentLogs.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-1 rounded-lg border border-border/80 bg-surface-raised px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-text-faint">
                  <span>{item.direction}</span>
                  <span>{item.status}</span>
                </div>
                <p className="text-text-muted">{item.details}</p>
                {item.createdAt && (
                  <span className="text-xs text-text-faint">{formatRelativeDate(item.createdAt)}</span>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 rounded-xl border border-border bg-surface p-4 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,0.8fr))]">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by title or chapter"
          className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text placeholder:text-text-faint focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
          aria-label="Library search"
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as LibraryStatus | "all")}
          className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
          aria-label="Status filter"
        >
          <option value="all">All statuses</option>
          {STATUS_ORDER.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <select
          value={collectionFilter}
          onChange={(event) => setCollectionFilter(event.target.value)}
          className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
          aria-label="Collection filter"
        >
          <option value="all">All collections</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name}
            </option>
          ))}
        </select>
        <select
          value={tagFilter}
          onChange={(event) => setTagFilter(event.target.value)}
          className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
          aria-label="Tag filter"
        >
          <option value="all">All tags</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
        <select
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as SortMode)}
          className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
          aria-label="Sort library"
        >
          <option value="updated">Recently updated</option>
          <option value="added">Recently added</option>
          <option value="title">Title A-Z</option>
          <option value="unread">Most unread</option>
        </select>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text">Collections</h2>
          <span className="text-sm text-text-faint">{collections.length}</span>
        </div>

        <form
          onSubmit={(event) => void handleCreateCollection(event)}
          className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-[1.2fr_1.6fr_auto]"
        >
          <input
            value={collectionName}
            onChange={(event) => setCollectionName(event.target.value)}
            placeholder="Collection name"
            className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text placeholder:text-text-faint focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
            aria-label="Collection name"
          />
          <input
            value={collectionDescription}
            onChange={(event) => setCollectionDescription(event.target.value)}
            placeholder="Description"
            className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text placeholder:text-text-faint focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
            aria-label="Collection description"
          />
          <button
            type="submit"
            disabled={savingCollection}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-void transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-70"
          >
            {savingCollection ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            New collection
          </button>
        </form>

        {collections.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {collections.map((collection) => (
              <div
                key={collection.id}
                className="rounded-xl border border-border bg-surface p-4"
              >
                {editingCollectionId === collection.id ? (
                  <div className="space-y-3">
                    <input
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
                      aria-label="Edit collection name"
                    />
                    <input
                      value={editingDescription}
                      onChange={(event) => setEditingDescription(event.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
                      aria-label="Edit collection description"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleUpdateCollection(collection.id)}
                        disabled={savingCollection}
                        className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-void transition-colors hover:bg-accent-muted"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingCollectionId(null)}
                        type="button"
                        className="rounded-lg border border-border px-3 py-2 text-sm text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-text">{collection.name}</p>
                        <p className="mt-1 text-xs text-text-faint">
                          {collection.seriesCount} series
                        </p>
                      </div>

                      <div className="flex gap-1">
                        <button
                          onClick={() => startEditingCollection(collection)}
                          className="rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                          aria-label={`Edit ${collection.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => void handleDeleteCollection(collection.id)}
                          className="rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-raised hover:text-dropped"
                          aria-label={`Delete ${collection.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {collection.description && (
                      <p className="text-sm text-text-muted">{collection.description}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border bg-surface p-4 text-sm text-text-muted">
            Create collections to build custom shelves like Favorites, Cozy Reads, or Weekend Catch-up.
          </p>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text">Tags</h2>
          <span className="text-sm text-text-faint">{tags.length}</span>
        </div>

        <form
          onSubmit={(event) => void handleCreateTag(event)}
          className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-[1.2fr_140px_160px_auto]"
        >
          <input
            value={tagName}
            onChange={(event) => setTagName(event.target.value)}
            placeholder="Tag name"
            className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text placeholder:text-text-faint focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
            aria-label="Tag name"
          />
          <select
            value={tagType}
            onChange={(event) => setTagType(event.target.value as LibraryTagType)}
            className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
            aria-label="Tag type"
          >
            {Object.entries(TAG_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            type="color"
            value={tagColor}
            onChange={(event) => setTagColor(event.target.value)}
            className="h-11 w-full rounded-lg border border-border bg-surface-raised px-2 py-2"
            aria-label="Tag color"
          />
          <button
            type="submit"
            disabled={savingTag}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-void transition-colors hover:bg-accent-muted disabled:cursor-not-allowed disabled:opacity-70"
          >
            {savingTag ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            New tag
          </button>
        </form>

        {tags.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tags.map((tag) => (
              <div key={tag.id} className="rounded-xl border border-border bg-surface p-4">
                {editingTagId === tag.id ? (
                  <div className="space-y-3">
                    <input
                      value={editingTagName}
                      onChange={(event) => setEditingTagName(event.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
                      aria-label="Edit tag name"
                    />
                    <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                      <select
                        value={editingTagType}
                        onChange={(event) => setEditingTagType(event.target.value as LibraryTagType)}
                        className="rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-sm text-text focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
                        aria-label="Edit tag type"
                      >
                        {Object.entries(TAG_TYPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="color"
                        value={editingTagColor}
                        onChange={(event) => setEditingTagColor(event.target.value)}
                        className="h-11 w-full rounded-lg border border-border bg-surface-raised px-2 py-2"
                        aria-label="Edit tag color"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleUpdateTag(tag.id)}
                        disabled={savingTag}
                        className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-void transition-colors hover:bg-accent-muted"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingTagId(null)}
                        type="button"
                        className="rounded-lg border border-border px-3 py-2 text-sm text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 rounded-full border border-black/10"
                            style={{ backgroundColor: tag.color ?? "#6b7280" }}
                            aria-hidden="true"
                          />
                          <p className="text-sm font-medium text-text">{tag.name}</p>
                        </div>
                        <p className="mt-1 text-xs text-text-faint">
                          {TAG_TYPE_LABELS[tag.type]} • {tag.seriesCount} series
                        </p>
                      </div>

                      <div className="flex gap-1">
                        <button
                          onClick={() => startEditingTag(tag)}
                          className="rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                          aria-label={`Edit ${tag.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => void handleDeleteTag(tag.id)}
                          className="rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-raised hover:text-dropped"
                          aria-label={`Delete ${tag.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border bg-surface p-4 text-sm text-text-muted">
            Create personal tags like Cozy, Favorite Villains, or Rainy Night to organize your library.
          </p>
        )}
      </section>

      {entries.length === 0 && (
        <div className="flex min-h-[24vh] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-surface text-center">
          <BookOpen className="h-12 w-12 text-text-faint" />
          <div>
            <h2 className="text-xl font-semibold text-text">Your Library is empty</h2>
            <p className="mt-1 text-sm text-text-muted">
              Add series from search or a detail page to start building your shelves.
            </p>
          </div>
        </div>
      )}

      {entries.length > 0 && filteredEntries.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-sm text-text-muted">
          No library entries match the current filters.
        </div>
      )}

      {hasActiveFilters && filteredEntries.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-text">Filtered library</h2>
            <span className="text-sm text-text-faint">{filteredEntries.length}</span>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {filteredEntries.map((entry) => (
              <SeriesCard
                key={entry.sourceSeriesId}
                sourceId={entry.sourceSeriesId}
                title={entry.title}
                coverUrl={entry.coverUrl ?? undefined}
                status={STATUS_LABELS[entry.status]}
              />
            ))}
          </div>
        </section>
      )}

      {!hasActiveFilters && continueReading.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-accent" />
            <h2 className="text-lg font-semibold text-text">Continue reading</h2>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {continueReading.map((entry) => (
              <Link
                key={entry.sourceSeriesId}
                href={`/read/${entry.sourceSeriesId}/${entry.currentChapterSourceId}`}
                className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent-muted hover:bg-surface-raised"
              >
                <p className="text-sm font-medium text-text">{entry.title}</p>
                <p className="mt-1 text-sm text-text-muted">{entry.currentChapterTitle ?? "Resume reading"}</p>
                <p className="mt-3 text-xs text-text-faint">
                  Page {(entry.currentPage ?? 0) + 1}
                  {entry.progressUpdatedAt ? ` • Updated ${formatRelativeDate(entry.progressUpdatedAt)}` : ""}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!hasActiveFilters && insights.unreadChapters.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-text">Unread chapters</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {insights.unreadChapters.map((entry) => (
              <Link
                key={entry.sourceSeriesId}
                href={
                  entry.currentChapterSourceId
                    ? `/read/${entry.sourceSeriesId}/${entry.currentChapterSourceId}`
                    : `/series/${entry.sourceSeriesId}`
                }
                className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent-muted hover:bg-surface-raised"
              >
                <p className="text-sm font-medium text-text">{entry.title}</p>
                <p className="mt-1 text-sm text-text-muted">
                  {entry.unreadChapters} unread chapter{entry.unreadChapters === 1 ? "" : "s"}
                </p>
                <p className="mt-3 text-xs text-text-faint">
                  {entry.completedChapters} of {entry.totalChapters} completed
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!hasActiveFilters && insights.stalledSeries.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-text">Stalled series</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {insights.stalledSeries.map((entry) => (
              <Link
                key={entry.sourceSeriesId}
                href={
                  entry.currentChapterSourceId
                    ? `/read/${entry.sourceSeriesId}/${entry.currentChapterSourceId}`
                    : `/series/${entry.sourceSeriesId}`
                }
                className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent-muted hover:bg-surface-raised"
              >
                <p className="text-sm font-medium text-text">{entry.title}</p>
                <p className="mt-1 text-sm text-text-muted">
                  {entry.unreadChapters} chapters waiting
                </p>
                <p className="mt-3 text-xs text-text-faint">
                  Last progress {formatRelativeDate(entry.progressUpdatedAt)}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!hasActiveFilters && insights.recentlyCompleted.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-text">Recently completed</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {insights.recentlyCompleted.map((entry) => (
              <Link
                key={entry.sourceSeriesId}
                href={
                  entry.lastCompletedChapterSourceId
                    ? `/read/${entry.sourceSeriesId}/${entry.lastCompletedChapterSourceId}`
                    : `/series/${entry.sourceSeriesId}`
                }
                className="rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent-muted hover:bg-surface-raised"
              >
                <p className="text-sm font-medium text-text">{entry.title}</p>
                <p className="mt-1 text-sm text-text-muted">
                  {entry.lastCompletedChapterTitle ?? "Completed recently"}
                </p>
                <p className="mt-3 text-xs text-text-faint">
                  Finished {formatRelativeDate(entry.lastCompletedAt)}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!hasActiveFilters && recentlyAdded.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-text">Recently added</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {recentlyAdded.map((entry) => (
              <SeriesCard
                key={entry.sourceSeriesId}
                sourceId={entry.sourceSeriesId}
                title={entry.title}
                coverUrl={entry.coverUrl ?? undefined}
                status={STATUS_LABELS[entry.status]}
              />
            ))}
          </div>
        </section>
      )}

      {!hasActiveFilters && entriesByStatus.map((group) => (
        <section key={group.status} className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-text">{group.label}</h2>
            <span className="text-sm text-text-faint">{group.entries.length}</span>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {group.entries.map((entry) => (
              <SeriesCard
                key={entry.sourceSeriesId}
                sourceId={entry.sourceSeriesId}
                title={entry.title}
                coverUrl={entry.coverUrl ?? undefined}
                status={group.label}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
