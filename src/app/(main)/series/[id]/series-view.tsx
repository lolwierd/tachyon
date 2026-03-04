"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { Loader2, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { Cover } from "@/components/ui/cover";
import { SelectDropdown } from "@/components/ui/select";
import { ChapterListItem } from "@/components/chapter-list-item";
import { JumpToChapter } from "@/components/ui/jump-to-chapter";
import { cn } from "@/lib/utils";
import type { SeriesDetail, Chapter } from "@/lib/sources/types";

/* ── Types ── */

type LibraryStatus = "reading" | "completed" | "paused" | "dropped" | "rereading" | "planning";

interface CollectionRecord {
  id: string;
  name: string;
  description: string | null;
}

interface TagRecord {
  id: string;
  name: string;
  color: string | null;
  type: string;
}

interface ReaderProgressInfo {
  currentChapterId: string | null;
  currentPage: number;
}

const STATUS_OPTIONS: Array<{ value: LibraryStatus; label: string }> = [
  { value: "reading", label: "Reading" },
  { value: "planning", label: "Planning" },
  { value: "completed", label: "Completed" },
  { value: "paused", label: "Paused" },
  { value: "rereading", label: "Rereading" },
  { value: "dropped", label: "Dropped" },
];

export function SeriesView({ sourceId }: { sourceId: string }) {
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [chaptersLoading, setChaptersLoading] = useState(true);
  const [descExpanded, setDescExpanded] = useState(false);
  const [chaptersReversed, setChaptersReversed] = useState(false);

  // Library
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus>("planning");
  const [libraryEntryStatus, setLibraryEntryStatus] = useState<LibraryStatus | null>(null);
  const [librarySaving, setLibrarySaving] = useState(false);

  // Collections & Tags
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  // Reading progress
  const [seriesProgress, setSeriesProgress] = useState<ReaderProgressInfo | null>(null);

  // Chapter jump
  const chapterListRef = useRef<HTMLDivElement>(null);
  const [jumpTarget, setJumpTarget] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [seriesRes, chaptersRes, libraryRes, collectionsRes, seriesCollectionsRes, tagsRes, seriesTagsRes, readerStateRes] =
          await Promise.all([
            fetch(`/api/series/${sourceId}`),
            fetch(`/api/series/${sourceId}/chapters`),
            fetch(`/api/library/${sourceId}`),
            fetch("/api/collections"),
            fetch(`/api/collections/series/${sourceId}`),
            fetch("/api/tags"),
            fetch(`/api/tags/series/${sourceId}`),
            fetch(`/api/reader/state?seriesId=${sourceId}`),
          ]);

        if (seriesRes.ok) setSeries(await seriesRes.json());
        setLoading(false);

        if (chaptersRes.ok) setChapters(await chaptersRes.json());
        setChaptersLoading(false);

        if (libraryRes.ok) {
          const entry = (await libraryRes.json()) as { status: LibraryStatus };
          setLibraryEntryStatus(entry.status);
          setLibraryStatus(entry.status);
        }

        if (collectionsRes.ok) setCollections(await collectionsRes.json());
        if (seriesCollectionsRes.ok) {
          const m = (await seriesCollectionsRes.json()) as { collectionIds: string[] };
          setSelectedCollectionIds(m.collectionIds);
        }
        if (tagsRes.ok) setTags(await tagsRes.json());
        if (seriesTagsRes.ok) {
          const m = (await seriesTagsRes.json()) as { tagIds: string[] };
          setSelectedTagIds(m.tagIds);
        }
        if (readerStateRes.ok) {
          const state = await readerStateRes.json();
          if (state.seriesProgress) {
            setSeriesProgress({
              currentChapterId: state.seriesProgress.currentChapterId,
              currentPage: state.seriesProgress.currentPage,
            });
          }
        }
      } catch {
        setLoading(false);
        setChaptersLoading(false);
      }
    }
    void load();
  }, [sourceId]);

  async function handleLibrarySave() {
    if (!series) return;
    setLibrarySaving(true);
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesId: sourceId, status: libraryStatus, series, chapters }),
      });
      if (res.ok) {
        const entry = (await res.json()) as { status: LibraryStatus };
        setLibraryEntryStatus(entry.status);
        setLibraryStatus(entry.status);
      }
    } finally {
      setLibrarySaving(false);
    }
  }

  async function handleCollectionToggle(collectionId: string, checked: boolean) {
    if (!series) return;
    const next = checked
      ? [...new Set([...selectedCollectionIds, collectionId])]
      : selectedCollectionIds.filter((id) => id !== collectionId);
    setSelectedCollectionIds(next);
    try {
      const res = await fetch(`/api/collections/series/${sourceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionIds: next, series }),
      });
      if (res.ok) {
        const p = (await res.json()) as { collectionIds: string[] };
        setSelectedCollectionIds(p.collectionIds);
      }
    } catch { /* silent */ }
  }

  async function handleTagToggle(tagId: string, checked: boolean) {
    if (!series) return;
    const next = checked
      ? [...new Set([...selectedTagIds, tagId])]
      : selectedTagIds.filter((id) => id !== tagId);
    setSelectedTagIds(next);
    try {
      const res = await fetch(`/api/tags/series/${sourceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagIds: next, series }),
      });
      if (res.ok) {
        const p = (await res.json()) as { tagIds: string[] };
        setSelectedTagIds(p.tagIds);
      }
    } catch { /* silent */ }
  }

  function handleJump(chapterNo: number) {
    setJumpTarget(chapterNo);
    // Scroll to chapter in the list
    if (chapterListRef.current) {
      const el = chapterListRef.current.querySelector(`[data-chapter-no="${chapterNo}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        // Find closest
        const closest = chapters.reduce((prev, curr) =>
          Math.abs(curr.chapterNo - chapterNo) < Math.abs(prev.chapterNo - chapterNo) ? curr : prev,
        );
        const closestEl = chapterListRef.current.querySelector(`[data-chapter-no="${closest.chapterNo}"]`);
        closestEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    setTimeout(() => setJumpTarget(null), 2000);
  }

  const displayedChapters = useMemo(
    () => (chaptersReversed ? [...chapters].reverse() : chapters),
    [chapters, chaptersReversed],
  );

  // Determine "Continue Reading" chapter
  const continueChapter = useMemo(() => {
    if (!seriesProgress?.currentChapterId) return null;
    // Find the current chapter's source ID in the chapter list
    // The seriesProgress.currentChapterId is the internal DB id, but we need sourceChapterId
    // For now, we use it as-is since the reader state stores it appropriately
    return seriesProgress.currentChapterId;
  }, [seriesProgress]);

  /* ── Loading ── */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
      </div>
    );
  }

  if (!series) {
    return (
      <div className="py-32 text-center">
        <p className="font-display text-lg text-text-muted">Series not found</p>
      </div>
    );
  }

  const meta = [series.type, series.status, series.year].filter(Boolean).join(" · ");

  return (
    <div className="space-y-10">
      {/* ── Hero: two columns on desktop ── */}
      <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
        {/* Left: Cover + actions (sticky on desktop) */}
        <div className="shrink-0 sm:sticky sm:top-6 sm:self-start sm:w-56">
          <Cover
            src={`/api/media/cover/${sourceId}`}
            alt={series.title}
            className="w-full"
            priority
            sizes="(max-width: 640px) 100vw, 224px"
          />

          {/* Continue Reading / Start Reading CTA */}
          <div className="mt-4 space-y-2">
            {continueChapter ? (
              <Link
                href={`/read/${sourceId}/${continueChapter}`}
                className="flex w-full items-center justify-center rounded-sm bg-accent py-2.5 text-sm font-medium text-void transition-colors duration-150 hover:bg-accent-muted"
              >
                Continue reading
              </Link>
            ) : chapters.length > 0 ? (
              <Link
                href={`/read/${sourceId}/${chapters[chapters.length - 1]?.sourceChapterId}`}
                className="flex w-full items-center justify-center rounded-sm bg-accent py-2.5 text-sm font-medium text-void transition-colors duration-150 hover:bg-accent-muted"
              >
                Start reading
              </Link>
            ) : null}

            {/* Library status */}
            <div className="space-y-1.5">
              <SelectDropdown
                value={libraryStatus}
                onChange={(e) => setLibraryStatus(e.target.value as LibraryStatus)}
                className="w-full text-xs"
                aria-label="Library status"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </SelectDropdown>
              <button
                onClick={() => void handleLibrarySave()}
                disabled={librarySaving}
                className="w-full rounded-sm border border-border py-2 text-xs font-medium text-text-muted transition-colors duration-150 hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {librarySaving ? "Saving…" : libraryEntryStatus ? "Update" : "Add to library"}
              </button>
            </div>

            {/* Collections — compact toggles */}
            {collections.length > 0 && (
              <div className="space-y-1 pt-2">
                <p className="text-[10px] font-medium uppercase tracking-widest text-text-faint">
                  Collections
                </p>
                {collections.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-2 py-0.5 text-xs text-text-muted"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCollectionIds.includes(c.id)}
                      onChange={(e) => void handleCollectionToggle(c.id, e.target.checked)}
                      className="h-3 w-3 rounded-sm border-border bg-surface-raised text-accent accent-accent"
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            )}

            {/* Tags — compact toggles */}
            {tags.length > 0 && (
              <div className="space-y-1 pt-2">
                <p className="text-[10px] font-medium uppercase tracking-widest text-text-faint">
                  Tags
                </p>
                {tags.map((t) => (
                  <label
                    key={t.id}
                    className="flex cursor-pointer items-center gap-2 py-0.5 text-xs text-text-muted"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTagIds.includes(t.id)}
                      onChange={(e) => void handleTagToggle(t.id, e.target.checked)}
                      className="h-3 w-3 rounded-sm border-border bg-surface-raised text-accent accent-accent"
                    />
                    {t.color && (
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                    )}
                    {t.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Metadata */}
        <div className="min-w-0 flex-1 space-y-5">
          <div>
            <h1 className="font-display text-3xl leading-tight text-text sm:text-4xl">
              {series.title}
            </h1>
            {series.authors.length > 0 && (
              <p className="mt-1.5 text-sm text-text-muted">
                By {series.authors.join(" & ")}
              </p>
            )}
            {meta && (
              <p className="mt-1 text-xs text-text-faint">{meta}</p>
            )}
          </div>

          {series.description && (
            <div>
              <p
                className={cn(
                  "text-sm leading-relaxed text-text-muted",
                  !descExpanded && "line-clamp-4",
                )}
              >
                {series.description}
              </p>
              {series.description.length > 200 && (
                <button
                  onClick={() => setDescExpanded(!descExpanded)}
                  className="mt-1 text-xs font-medium text-accent transition-colors hover:text-accent-muted"
                >
                  {descExpanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}

          {series.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {series.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-surface-raised px-2 py-0.5 text-[11px] text-text-faint"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {series.anilistUrl && (
            <a
              href={series.anilistUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-text-faint transition-colors hover:text-accent"
            >
              <ExternalLink className="h-3 w-3" />
              AniList
            </a>
          )}
        </div>
      </div>

      {/* ── Chapters ── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-baseline gap-2">
            <span className="font-display text-xl text-text">Chapters</span>
            {!chaptersLoading && (
              <span className="font-mono text-sm text-text-faint">
                {chapters.length}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <JumpToChapter onJump={handleJump} />
            <button
              onClick={() => setChaptersReversed(!chaptersReversed)}
              className="flex items-center gap-1 rounded-sm px-2 py-1.5 text-xs text-text-muted transition-colors duration-150 hover:bg-surface-raised hover:text-text"
            >
              {chaptersReversed ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {chaptersReversed ? "Oldest" : "Newest"}
            </button>
          </div>
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
          <div ref={chapterListRef} className="divide-y divide-border-subtle">
            {displayedChapters.map((ch) => {
              const isCurrent = continueChapter === ch.sourceChapterId;
              return (
                <ChapterListItem
                  key={ch.sourceChapterId}
                  seriesId={sourceId}
                  chapterId={ch.sourceChapterId}
                  chapterNo={ch.chapterNo}
                  title={ch.title}
                  isCurrent={isCurrent}
                  readState="unread"
                  className={
                    jumpTarget !== null && Math.abs(ch.chapterNo - jumpTarget) < 0.5
                      ? "bg-accent-faint"
                      : undefined
                  }
                  data-chapter-no={ch.chapterNo}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
