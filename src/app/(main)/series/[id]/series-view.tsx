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

  useEffect(() => {
    async function load() {
      try {
        const [seriesRes, chaptersRes] = await Promise.all([
          fetch(`/api/series/${sourceId}`),
          fetch(`/api/series/${sourceId}/chapters`),
        ]);

        if (seriesRes.ok) {
          setSeries(await seriesRes.json());
        }
        setLoading(false);

        if (chaptersRes.ok) {
          setChapters(await chaptersRes.json());
        }
        setChaptersLoading(false);
      } catch {
        setLoading(false);
        setChaptersLoading(false);
      }
    }
    load();
  }, [sourceId]);

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
