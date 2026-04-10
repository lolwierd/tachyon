"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useNsfw } from "@/lib/nsfw-context";

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
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
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

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-sm border border-border-subtle bg-surface p-4">
      <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl leading-none text-text">
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-text-muted">{sub}</p>}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-sm border border-border-subtle bg-surface p-4">
      <div className="skeleton h-3 w-16 rounded-sm" />
      <div className="skeleton mt-2 h-7 w-20 rounded-sm" />
      <div className="skeleton mt-2 h-3 w-24 rounded-sm" />
    </div>
  );
}

function SkeletonSection({ rows = 4 }: { rows?: number }) {
  return (
    <section className="rounded-sm border border-border-subtle bg-surface p-5">
      <div className="skeleton mb-4 h-5 w-32 rounded-sm" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="skeleton h-4 w-full rounded-sm" />
        ))}
      </div>
    </section>
  );
}

function ActivityChart({ data }: { data: ReadingStats["readingByDay"] }) {
  const maxChapters = Math.max(...data.map((d) => d.chapters), 1);

  return (
    <section className="rounded-sm border border-border-subtle bg-surface p-5">
      <div className="mb-4">
        <h2 className="font-display text-lg text-text">Reading Activity</h2>
        <p className="mt-0.5 text-xs text-text-faint">
          Chapters completed per day, last 30 days
        </p>
      </div>

      <div className="flex items-end gap-[2px]" style={{ height: 120 }}>
        {data.map((d) => {
          const pct = (d.chapters / maxChapters) * 100;
          return (
            <div
              key={d.date}
              className="group relative flex-1"
              style={{ height: "100%" }}
            >
              <div className="absolute inset-x-0 bottom-0 flex flex-col items-center justify-end h-full">
                <div
                  className={cn(
                    "w-full rounded-t-sm transition-colors",
                    d.chapters > 0
                      ? "bg-accent hover:bg-accent-muted"
                      : "bg-surface-raised",
                  )}
                  style={{
                    height: d.chapters > 0 ? `${Math.max(pct, 4)}%` : "2px",
                  }}
                />
              </div>

              {/* Tooltip */}
              <div className="pointer-events-none absolute -top-14 left-1/2 z-10 hidden -translate-x-1/2 rounded-sm border border-border bg-surface-raised px-2 py-1.5 text-center group-hover:block">
                <p className="whitespace-nowrap text-[10px] text-text-muted">
                  {formatDate(d.date)}
                </p>
                <p className="text-xs font-medium text-text">
                  {d.chapters} ch / {d.pages} pg
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* X-axis labels */}
      <div className="mt-1 flex justify-between text-[9px] text-text-faint">
        <span>{formatDate(data[0]?.date ?? "")}</span>
        <span>{formatDate(data[data.length - 1]?.date ?? "")}</span>
      </div>
    </section>
  );
}

function DayOfWeekChart({
  data,
}: {
  data: ReadingStats["readingByDayOfWeek"];
}) {
  const maxChapters = Math.max(...data.map((d) => d.chapters), 1);

  return (
    <section className="rounded-sm border border-border-subtle bg-surface p-5">
      <div className="mb-4">
        <h2 className="font-display text-lg text-text">By Day of Week</h2>
        <p className="mt-0.5 text-xs text-text-faint">
          Total chapters completed, all time
        </p>
      </div>

      <div className="flex items-end gap-2" style={{ height: 80 }}>
        {data.map((d) => {
          const pct = (d.chapters / maxChapters) * 100;
          return (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full flex items-end"
                style={{ height: 60 }}
              >
                <div
                  className={cn(
                    "w-full rounded-t-sm",
                    d.chapters > 0 ? "bg-accent" : "bg-surface-raised",
                  )}
                  style={{
                    height: d.chapters > 0 ? `${Math.max(pct, 6)}%` : "2px",
                  }}
                />
              </div>
              <span className="text-[10px] text-text-faint">{d.day}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TopSeriesList({
  data,
}: {
  data: ReadingStats["topSeries"];
}) {
  if (data.length === 0) {
    return (
      <section className="rounded-sm border border-border-subtle bg-surface p-5">
        <h2 className="font-display text-lg text-text">Top Series</h2>
        <p className="mt-2 text-xs text-text-faint">
          No completed chapters yet.
        </p>
      </section>
    );
  }

  const maxChapters = data[0]?.chaptersRead ?? 1;

  return (
    <section className="rounded-sm border border-border-subtle bg-surface p-5">
      <div className="mb-4">
        <h2 className="font-display text-lg text-text">Top Series</h2>
        <p className="mt-0.5 text-xs text-text-faint">
          By chapters completed
        </p>
      </div>

      <div className="space-y-2">
        {data.map((s, i) => {
          const pct = (s.chaptersRead / maxChapters) * 100;
          return (
            <div key={s.seriesId} className="group">
              <div className="flex items-center gap-2">
                <span className="w-4 text-right text-[10px] text-text-faint">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm text-text">{s.title}</p>
                    <span className="shrink-0 text-xs tabular-nums text-text-muted">
                      {s.chaptersRead}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1 w-full rounded-full bg-surface-raised">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StatusDistribution({
  data,
}: {
  data: ReadingStats["statusDistribution"];
}) {
  const total = data.reduce((sum, d) => sum + d.count, 0);

  if (total === 0) {
    return (
      <section className="rounded-sm border border-border-subtle bg-surface p-5">
        <h2 className="font-display text-lg text-text">Library Status</h2>
        <p className="mt-2 text-xs text-text-faint">No series in library.</p>
      </section>
    );
  }

  return (
    <section className="rounded-sm border border-border-subtle bg-surface p-5">
      <div className="mb-4">
        <h2 className="font-display text-lg text-text">Library Status</h2>
        <p className="mt-0.5 text-xs text-text-faint">
          Distribution across {total} series
        </p>
      </div>

      {/* Stacked bar */}
      <div className="flex h-2 w-full overflow-hidden rounded-full">
        {data.map((d) => (
          <div
            key={d.status}
            className={cn("h-full", STATUS_COLORS[d.status] ?? "bg-text-faint")}
            style={{ width: `${(d.count / total) * 100}%` }}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {data.map((d) => (
          <div key={d.status} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  STATUS_COLORS[d.status] ?? "bg-text-faint",
                )}
              />
              <span
                className={cn(
                  "text-xs capitalize",
                  STATUS_TEXT_COLORS[d.status] ?? "text-text-muted",
                )}
              >
                {d.status}
              </span>
            </div>
            <span className="text-xs tabular-nums text-text-muted">
              {d.count}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentActivityList({
  data,
}: {
  data: ReadingStats["recentActivity"];
}) {
  if (data.length === 0) {
    return (
      <section className="rounded-sm border border-border-subtle bg-surface p-5">
        <h2 className="font-display text-lg text-text">Recent Activity</h2>
        <p className="mt-2 text-xs text-text-faint">No activity yet.</p>
      </section>
    );
  }

  return (
    <section className="rounded-sm border border-border-subtle bg-surface p-5">
      <div className="mb-4">
        <h2 className="font-display text-lg text-text">Recent Activity</h2>
        <p className="mt-0.5 text-xs text-text-faint">
          Last {data.length} completed chapters
        </p>
      </div>

      <div className="space-y-1">
        {data.map((a, i) => (
          <div
            key={`${a.date}-${i}`}
            className="flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 transition-colors hover:bg-surface-raised"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-text">{a.seriesTitle}</p>
              <p className="truncate text-xs text-text-muted">
                {a.chapterTitle}
              </p>
            </div>
            <span className="shrink-0 text-[10px] text-text-faint">
              {timeAgo(a.date)}
            </span>
          </div>
        ))}
      </div>
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

  if (error) {
    return (
      <div className="space-y-6 pb-20">
        <div>
          <h1 className="font-display text-3xl leading-none text-text">
            Statistics
          </h1>
          <p className="mt-1 text-xs text-text-faint">
            Your reading at a glance.
          </p>
        </div>
        <div className="rounded-sm border border-dropped/30 bg-surface p-5 text-center">
          <p className="text-sm text-dropped">{error}</p>
        </div>
      </div>
    );
  }

  if (loading || !stats) {
    return (
      <div className="space-y-6 pb-20">
        <div>
          <h1 className="font-display text-3xl leading-none text-text">
            Statistics
          </h1>
          <p className="mt-1 text-xs text-text-faint">
            Your reading at a glance.
          </p>
        </div>

        {/* Skeleton stat cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>

        <SkeletonSection rows={6} />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SkeletonSection rows={5} />
          <SkeletonSection rows={4} />
        </div>

        <SkeletonSection rows={5} />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div>
        <h1 className="font-display text-3xl leading-none text-text">
          Statistics
        </h1>
        <p className="mt-1 text-xs text-text-faint">
          Your reading at a glance.
        </p>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Chapters Read"
          value={formatNumber(stats.totalChaptersRead)}
          sub={`${formatNumber(stats.totalPagesRead)} pages`}
        />
        <StatCard
          label="Current Streak"
          value={`${stats.currentStreak}d`}
          sub={`Best: ${stats.longestStreak}d`}
        />
        <StatCard
          label="Avg / Day"
          value={stats.averageChaptersPerDay.toFixed(1)}
          sub="Last 30 days"
        />
        <StatCard
          label="Library"
          value={stats.totalSeriesInLibrary}
          sub={`${stats.totalSeriesCompleted} completed`}
        />
      </div>

      {/* Activity chart */}
      <ActivityChart data={stats.readingByDay} />

      {/* Two-column: top series + status + day of week */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TopSeriesList data={stats.topSeries} />
        <div className="space-y-4">
          <StatusDistribution data={stats.statusDistribution} />
          <DayOfWeekChart data={stats.readingByDayOfWeek} />
        </div>
      </div>

      {/* Recent activity */}
      <RecentActivityList data={stats.recentActivity} />
    </div>
  );
}
