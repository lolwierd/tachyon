"use client";

/**
 * Stats — rewritten as a reading ledger rather than a dashboard.
 *
 * The earlier iteration stacked six bordered cards of charts and
 * metric-tiles. The DESIGN.md explicitly rejected that treatment for
 * the library home ("felt corporate, like Grafana") but the stats page
 * had inherited it anyway. This version removes the box-per-section
 * chrome and lets the page flow like a broadsheet: a masthead of
 * running numbers at the top, an ink-stroke calendar of the last month,
 * a trophy shelf of the most-read series (covers instead of bars),
 * a short ruled list for the week's weight by day, and a final log of
 * recent chapters.
 *
 * Typographic cues:
 *   — Numbers go into Instrument Serif. They're the poetry here.
 *   — Labels stay mono + micro-caps; they're the ledger rules.
 *   — Section titles are serif, subtitles italic serif (mirrors the
 *     chapter-transition screen, the app's north-star surface).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useNsfw } from "@/lib/nsfw-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Cover } from "@/components/ui/cover";
import { buildCoverSrc, buildSeriesHref } from "@/lib/reader/url";

interface ReadingStats {
  totalChaptersRead: number;
  totalPagesRead: number;
  totalSeriesInLibrary: number;
  totalSeriesCompleted: number;
  averageChaptersPerDay: number;
  currentStreak: number;
  longestStreak: number;
  readingByDay: Array<{ date: string; chapters: number; pages: number }>;
  readingByDayOfWeek: Array<{ day: string; chapters: number }>;
  topSeries: Array<{
    seriesId: string;
    title: string;
    chaptersRead: number;
    coverUrl: string | null;
  }>;
  statusDistribution: Array<{ status: string; count: number }>;
  recentActivity: Array<{
    date: string;
    seriesTitle: string;
    chapterTitle: string;
    type: string;
  }>;
}

const STATUS_COLORS: Record<string, string> = {
  reading: "bg-reading",
  completed: "bg-completed",
  paused: "bg-paused",
  dropped: "bg-dropped",
  planning: "bg-planning",
  rereading: "bg-rereading",
};

const STATUS_TEXT_COLORS: Record<string, string> = {
  reading: "text-reading",
  completed: "text-completed",
  paused: "text-paused",
  dropped: "text-dropped",
  planning: "text-planning",
  rereading: "text-rereading",
};

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function timeAgo(iso: string) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/* ── The masthead ─────────────────────────────────────────────────────
   Four running numbers across the top. A single ruled strip, not a
   grid of bordered cards. Reads like the dateline of a newspaper. */
function Masthead({
  chapters,
  pages,
  streak,
  best,
  avg,
  library,
  completed,
}: {
  chapters: number;
  pages: number;
  streak: number;
  best: number;
  avg: number;
  library: number;
  completed: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-border-subtle py-5 sm:grid-cols-4 sm:gap-x-0 sm:divide-x sm:divide-border-subtle">
      {[
        {
          label: "Chapters read",
          value: formatNumber(chapters),
          sub: `${formatNumber(pages)} pages`,
        },
        {
          label: "Current streak",
          value: streak === 1 ? "1 day" : `${streak} days`,
          sub: best > 0 ? `best ${best} days` : "—",
        },
        {
          label: "Avg per day",
          value: avg.toFixed(1),
          sub: "over the last month",
        },
        {
          label: "Library",
          value: String(library),
          sub: `${completed} completed`,
        },
      ].map((cell, idx) => (
        <div key={idx} className={cn("flex flex-col gap-1.5 sm:px-6", idx === 0 && "sm:pl-0")}>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">
            {cell.label}
          </p>
          <p className="font-display text-3xl leading-none text-text sm:text-4xl">
            {cell.value}
          </p>
          <p className="font-mono text-[11px] text-text-faint">{cell.sub}</p>
        </div>
      ))}
    </div>
  );
}

/* ── Calendar of ink ──────────────────────────────────────────────────
   The last 30 days as a grid of tiles. Tile fill scales with chapters
   read; absent days are a whisper of surface-raised so the grid's
   shape is readable even on sparse weeks. */
function InkCalendar({
  data,
}: {
  data: ReadingStats["readingByDay"];
}) {
  const max = Math.max(...data.map((d) => d.chapters), 1);

  function opacityFor(chapters: number): number {
    if (chapters === 0) return 0;
    // Four intensity buckets on a sqrt curve so small values stay
    // legible against big bursts.
    const ratio = Math.sqrt(chapters) / Math.sqrt(max);
    if (ratio < 0.25) return 0.2;
    if (ratio < 0.5) return 0.45;
    if (ratio < 0.8) return 0.75;
    return 1;
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-2xl leading-none text-text">
          The last month
        </h2>
        <p className="mt-1 font-display italic text-sm text-text-faint">
          One tile a day &mdash; fuller means heavier reading.
        </p>
      </div>

      <div className="grid grid-cols-10 gap-1 sm:grid-cols-[repeat(30,minmax(0,1fr))]">
        {data.map((d) => {
          const op = opacityFor(d.chapters);
          return (
            <div
              key={d.date}
              className="group relative aspect-square"
              title={`${formatDate(d.date)} — ${d.chapters} ch · ${d.pages} pg`}
            >
              <div
                className="absolute inset-0 rounded-[1px] bg-surface-raised"
                aria-hidden
              />
              {d.chapters > 0 && (
                <div
                  className="absolute inset-0 rounded-[1px] bg-accent transition-opacity duration-150 group-hover:opacity-100"
                  style={{ opacity: op }}
                />
              )}
              <div className="pointer-events-none absolute -top-12 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-center group-hover:block">
                <p className="font-mono text-[10px] text-text-muted">
                  {formatDate(d.date)}
                </p>
                <p className="font-mono text-xs text-text">
                  {d.chapters} ch · {d.pages} pg
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between font-mono text-[10px] text-text-faint">
        <span>{formatDate(data[0]?.date ?? "")}</span>
        <span className="flex items-center gap-1.5">
          <span>less</span>
          {[0.2, 0.45, 0.75, 1].map((op) => (
            <span
              key={op}
              className="h-2 w-2 rounded-[1px] bg-accent"
              style={{ opacity: op }}
            />
          ))}
          <span>more</span>
        </span>
        <span>{formatDate(data[data.length - 1]?.date ?? "")}</span>
      </div>
    </section>
  );
}

/* ── The top shelf ────────────────────────────────────────────────────
   A trophy shelf of most-read series. Covers + titles + a thin
   progress stroke — not a bar chart with a series name stapled to it. */
function TopShelf({ data }: { data: ReadingStats["topSeries"] }) {
  if (data.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="font-display text-2xl leading-none text-text">
          Most read
        </h2>
        <p className="font-display italic text-sm text-text-faint">
          Nothing finished yet.
        </p>
      </section>
    );
  }

  const max = data[0]?.chaptersRead ?? 1;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-2xl leading-none text-text">
          Most read
        </h2>
        <p className="mt-1 font-display italic text-sm text-text-faint">
          Where the hours went, in order.
        </p>
      </div>
      <ol className="space-y-2">
        {data.map((s, i) => {
          const pct = (s.chaptersRead / max) * 100;
          const proxied = s.coverUrl?.startsWith("http")
            ? buildCoverSrc(s.coverUrl, null)
            : s.coverUrl;
          return (
            <li key={s.seriesId}>
              <Link
                href={buildSeriesHref(s.seriesId, null)}
                className="group flex items-center gap-3 rounded-sm px-1 py-1.5 transition-colors hover:bg-surface"
              >
                <span className="w-5 shrink-0 text-right font-mono text-[10px] text-text-faint">
                  {i + 1}
                </span>
                <Cover
                  src={proxied}
                  alt={s.title}
                  className="h-10 w-7 shrink-0"
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm text-text transition-colors group-hover:text-accent">
                      {s.title}
                    </p>
                    <span className="shrink-0 font-mono text-xs text-text-muted tabular-nums">
                      {s.chaptersRead}
                    </span>
                  </div>
                  <div className="h-px w-full bg-surface-raised">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ── The stack ────────────────────────────────────────────────────────
   Library status — same information as the old stacked bar, but
   restructured as a single-row spine chart, one row per status. */
function TheStack({
  data,
}: {
  data: ReadingStats["statusDistribution"];
}) {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  if (total === 0) {
    return (
      <section className="space-y-3">
        <h2 className="font-display text-2xl leading-none text-text">
          The stack
        </h2>
        <p className="font-display italic text-sm text-text-faint">
          Empty library.
        </p>
      </section>
    );
  }

  const ordered = [...data].sort((a, b) => b.count - a.count);
  const max = ordered[0]?.count ?? 1;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-2xl leading-none text-text">
          The stack
        </h2>
        <p className="mt-1 font-display italic text-sm text-text-faint">
          {total} {total === 1 ? "book" : "books"}, sorted by shelf.
        </p>
      </div>
      <ul className="space-y-1.5">
        {ordered.map((d) => {
          const pct = (d.count / max) * 100;
          return (
            <li key={d.status} className="flex items-center gap-3 py-0.5">
              <span
                className={cn(
                  "w-[6rem] shrink-0 font-mono text-[11px] capitalize",
                  STATUS_TEXT_COLORS[d.status] ?? "text-text-muted",
                )}
              >
                {d.status}
              </span>
              <div className="h-1 flex-1 bg-surface-raised">
                <div
                  className={cn("h-full", STATUS_COLORS[d.status] ?? "bg-text-faint")}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right font-mono text-xs text-text-muted tabular-nums">
                {d.count}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── The week ─────────────────────────────────────────────────────────
   Day-of-week totals as a ruled list — a thin horizontal ink stroke
   per day, count on the right. Makes "you read on Sundays" legible
   at a glance without shouting. */
function TheWeek({
  data,
}: {
  data: ReadingStats["readingByDayOfWeek"];
}) {
  const max = Math.max(...data.map((d) => d.chapters), 1);
  const total = data.reduce((sum, d) => sum + d.chapters, 0);
  if (total === 0) {
    return (
      <section className="space-y-3">
        <h2 className="font-display text-2xl leading-none text-text">
          The week
        </h2>
        <p className="font-display italic text-sm text-text-faint">
          No sessions on record.
        </p>
      </section>
    );
  }
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-2xl leading-none text-text">
          The week
        </h2>
        <p className="mt-1 font-display italic text-sm text-text-faint">
          When you usually sit down, all time.
        </p>
      </div>
      <ul className="space-y-1.5">
        {data.map((d) => {
          const pct = (d.chapters / max) * 100;
          return (
            <li key={d.day} className="flex items-center gap-3 py-0.5">
              <span className="w-12 shrink-0 font-mono text-[11px] uppercase tracking-[0.1em] text-text-faint">
                {d.day}
              </span>
              <div className="h-1 flex-1 bg-surface-raised">
                <div
                  className="h-full bg-accent/70"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-xs text-text-muted tabular-nums">
                {d.chapters}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── The log ──────────────────────────────────────────────────────────
   A running entry list of the last completed chapters. This is the
   most ledger-like surface on the whole page. */
function TheLog({
  data,
}: {
  data: ReadingStats["recentActivity"];
}) {
  if (data.length === 0) return null;
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-2xl leading-none text-text">
          The log
        </h2>
        <p className="mt-1 font-display italic text-sm text-text-faint">
          What was read, most recently first.
        </p>
      </div>
      <ol className="divide-y divide-border-subtle">
        {data.map((a, i) => (
          <li
            key={`${a.date}-${i}`}
            className="flex items-baseline justify-between gap-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base text-text">
                {a.seriesTitle}
              </p>
              <p className="truncate font-mono text-xs text-text-muted">
                {a.chapterTitle}
              </p>
            </div>
            <span className="shrink-0 font-mono text-[10px] text-text-faint">
              {timeAgo(a.date)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function StatsPage() {
  const { nsfwEnabled } = useNsfw();
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const nsfwParam = nsfwEnabled ? "?nsfw=1" : "";
        const res = await fetch(`/api/stats${nsfwParam}`);
        if (!res.ok) {
          throw new Error(`Failed to load stats (${res.status})`);
        }
        const data = (await res.json()) as ReadingStats;
        if (!cancelled) {
          setStats(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load stats");
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
  }, [nsfwEnabled]);

  const header = (
    <div>
      <h1 className="font-display text-3xl leading-none text-text">
        Statistics
      </h1>
      <p className="mt-1 font-display italic text-sm text-text-faint">
        Your reading, recorded.
      </p>
    </div>
  );

  if (error) {
    return (
      <div className="space-y-6 pb-20">
        {header}
        <div className="rounded-sm border border-dropped/30 bg-surface p-5 text-center">
          <p className="text-sm text-dropped">{error}</p>
        </div>
      </div>
    );
  }

  if (loading || !stats) {
    return (
      <div className="space-y-10 pb-20">
        {header}
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-36 w-full" />
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const hasNothing =
    stats.totalChaptersRead === 0 && stats.totalSeriesInLibrary === 0;

  if (hasNothing) {
    return (
      <div className="space-y-10 pb-20">
        {header}
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <p className="font-display text-3xl text-text">A blank page.</p>
          <p className="max-w-xs font-display italic text-sm text-text-faint">
            Read something and this space will start keeping score.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-10 pb-20">
      {header}

      <Masthead
        chapters={stats.totalChaptersRead}
        pages={stats.totalPagesRead}
        streak={stats.currentStreak}
        best={stats.longestStreak}
        avg={stats.averageChaptersPerDay}
        library={stats.totalSeriesInLibrary}
        completed={stats.totalSeriesCompleted}
      />

      <InkCalendar data={stats.readingByDay} />

      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        <TopShelf data={stats.topSeries} />
        <div className="space-y-10">
          <TheStack data={stats.statusDistribution} />
          <TheWeek data={stats.readingByDayOfWeek} />
        </div>
      </div>

      <TheLog data={stats.recentActivity} />
    </div>
  );
}
