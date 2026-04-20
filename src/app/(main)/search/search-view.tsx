"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search as SearchIcon, Loader2, SlidersHorizontal, X, CloudOff, BookOpen } from "lucide-react";
import { SeriesGridCard } from "@/components/series-grid-card";
import { SelectDropdown } from "@/components/ui/select";
import { Button, LinkButton } from "@/components/ui/button";
import { useNsfw } from "@/lib/nsfw-context";
import { useOfflineMode } from "@/lib/offline/offline-mode-context";
import type { SearchResult } from "@/lib/sources/types";

const SORT_OPTIONS = [
  { value: "", label: "Best Match" },
  { value: "Popularity", label: "Popularity" },
  { value: "Latest Updates", label: "Latest Updates" },
  { value: "Recently Added", label: "Recently Added" },
  { value: "Alphabet", label: "Alphabet" },
] as const;

const TYPE_OPTIONS = [
  { value: "", label: "Any type" },
  { value: "Manga", label: "Manga" },
  { value: "Manhwa", label: "Manhwa" },
  { value: "Manhua", label: "Manhua" },
  { value: "OEL", label: "OEL" },
] as const;

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "Ongoing", label: "Ongoing" },
  { value: "Complete", label: "Complete" },
  { value: "Hiatus", label: "Hiatus" },
  { value: "Canceled", label: "Canceled" },
] as const;

export function SearchView({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<{ q?: string; showExtra?: string; sort?: string; type?: string; status?: string }>;
}) {
  const initialParams = use(searchParamsPromise);
  const router = useRouter();
  const params = useSearchParams();
  const { nsfwEnabled } = useNsfw();
  const { isOffline } = useOfflineMode();
  const initialQuery = params.get("q") || initialParams.q || "";
  const initialShowExtra =
    (params.get("showExtra") || initialParams.showExtra || "") === "1";
  const initialSort = params.get("sort") || initialParams.sort || "";
  const initialType = params.get("type") || initialParams.type || "";
  const initialStatus = params.get("status") || initialParams.status || "";

  const [query, setQuery] = useState(initialQuery);
  const [showExtra, setShowExtra] = useState(initialShowExtra);
  const [sortFilter, setSortFilter] = useState(initialSort);
  const [typeFilter, setTypeFilter] = useState(initialType);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [showFilters, setShowFilters] = useState(
    !!(initialSort || initialType || initialStatus),
  );
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const initialSearchDoneRef = useRef(false);
  const searchCounterRef = useRef(0);

  const doSearch = useCallback(
    async (
      q: string,
      options?: { showExtra?: boolean; sort?: string; type?: string; status?: string },
    ) => {
      const sortParam = options?.sort ?? sortFilter;
      const typeParam = options?.type ?? typeFilter;
      const statusParam = options?.status ?? statusFilter;

      // allow empty query when browsing with sort filter
      if (!q.trim() && !sortParam) return;

      // Skip the request entirely when offline — /api/search queries external
      // manga sources, so there's nothing useful to return from cache and the
      // request would just time out behind a dead tunnel.
      if (isOffline) {
        setResults([]);
        setSearched(true);
        setLoading(false);
        return;
      }

      const requestId = ++searchCounterRef.current;
      setLoading(true);
      setSearched(true);
      try {
        const nsfwParam = nsfwEnabled ? "&nsfw=1" : "";
        const shouldShowExtra = options?.showExtra ?? showExtra;
        const extraParam = shouldShowExtra ? "&showExtra=1" : "";
        let url = `/api/search?q=${encodeURIComponent(q.trim())}${nsfwParam}${extraParam}`;
        if (sortParam) url += `&sort=${encodeURIComponent(sortParam)}`;
        if (typeParam) url += `&type=${encodeURIComponent(typeParam)}`;
        if (statusParam) url += `&status=${encodeURIComponent(statusParam)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Search failed");
        if (requestId !== searchCounterRef.current) return;
        // The `as` cast is trusted shape assumption; if a scraper
        // returns a malformed item the `undefined` values propagate
        // into the grid render and crash a child. Filter to the
        // required scalar fields so the UI always gets a well-formed
        // list even if one source's adapter regressed.
        const json = (await res.json()) as { results?: unknown };
        const raw = Array.isArray(json?.results) ? json.results : [];
        const safe: SearchResult[] = raw.filter((item): item is SearchResult => {
          if (!item || typeof item !== "object") return false;
          const r = item as Record<string, unknown>;
          return typeof r.sourceId === "string"
            && r.sourceId.length > 0
            && typeof r.title === "string";
        });
        setResults(safe);
      } catch {
        if (requestId !== searchCounterRef.current) return;
        setResults([]);
      } finally {
        if (requestId === searchCounterRef.current) {
          setLoading(false);
        }
      }
    },
    [nsfwEnabled, showExtra, sortFilter, typeFilter, statusFilter, isOffline],
  );

  useEffect(() => {
    if (!initialSearchDoneRef.current && (initialQuery || initialSort)) {
      initialSearchDoneRef.current = true;
      doSearch(initialQuery, { sort: initialSort, type: initialType, status: initialStatus });
    }
  }, [initialQuery, initialSort, initialType, initialStatus, doSearch]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() && !sortFilter) return;
    const nextParams = new URLSearchParams();
    if (query.trim()) nextParams.set("q", query.trim());
    if (showExtra) nextParams.set("showExtra", "1");
    if (sortFilter) nextParams.set("sort", sortFilter);
    if (typeFilter) nextParams.set("type", typeFilter);
    if (statusFilter) nextParams.set("status", statusFilter);
    router.push(`/search?${nextParams.toString()}`, {
      scroll: false,
    });
    doSearch(query);
  }

  function handleToggleExtra() {
    const nextShowExtra = !showExtra;
    setShowExtra(nextShowExtra);

    if (!query.trim() && !sortFilter) {
      return;
    }

    const nextParams = new URLSearchParams();
    if (query.trim()) nextParams.set("q", query.trim());
    if (nextShowExtra) nextParams.set("showExtra", "1");
    if (sortFilter) nextParams.set("sort", sortFilter);
    if (typeFilter) nextParams.set("type", typeFilter);
    if (statusFilter) nextParams.set("status", statusFilter);

    router.replace(`/search?${nextParams.toString()}`, {
      scroll: false,
    });
    doSearch(query, { showExtra: nextShowExtra });
  }

  const hasActiveFilters = !!(sortFilter || typeFilter || statusFilter);
  const activeFilterCount =
    (sortFilter ? 1 : 0) + (typeFilter ? 1 : 0) + (statusFilter ? 1 : 0);

  function clearFilters() {
    setSortFilter("");
    setTypeFilter("");
    setStatusFilter("");
    if (query.trim() || searched) {
      doSearch(query, { sort: "", type: "", status: "" });
    }
  }

  if (isOffline) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border-subtle bg-surface-raised">
          <CloudOff className="h-6 w-6 text-text-muted" />
        </div>
        <div className="space-y-1">
          <h1 className="font-display text-2xl text-text">Search is offline</h1>
          <p className="max-w-md text-sm text-text-faint">
            Searching manga sources needs an internet connection. Your library and any chapters you&apos;ve downloaded are still available.
          </p>
        </div>
        <LinkButton href="/" variant="seal" size="md" leading={<BookOpen className="h-4 w-4" />}>
          Back to library
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-0 top-1/2 h-5 w-5 -translate-y-1/2 text-text-faint" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search manga, manhwa, comics…"
            className="w-full border-b border-border-subtle bg-transparent py-4 pl-8 pr-4 text-base text-text placeholder:text-text-faint transition-colors duration-150 focus:border-border focus:outline-none focus:ring-0"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            selected={showExtra}
            onClick={handleToggleExtra}
          >
            {showExtra ? "Hide extra providers" : "Show extra providers"}
          </Button>
          {!showExtra && (
            <span className="text-xs text-text-faint">Extra providers hidden by default</span>
          )}

          <div className="flex-1" />

          <Button
            variant="secondary"
            selected={showFilters || hasActiveFilters}
            onClick={() => setShowFilters((v) => !v)}
            leading={<SlidersHorizontal className="h-3.5 w-3.5" />}
            trailing={hasActiveFilters ? (
              <span className="rounded-full bg-accent/20 px-1.5 py-px font-mono text-[10px] font-medium text-accent">
                {activeFilterCount}
              </span>
            ) : undefined}
          >
            Filters
          </Button>
        </div>

        {showFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SelectDropdown
              value={sortFilter}
              onChange={(e) => setSortFilter(e.target.value)}
              className="w-36 text-xs"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectDropdown>

            <SelectDropdown
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-32 text-xs"
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectDropdown>

            <SelectDropdown
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-32 text-xs"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectDropdown>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                onClick={clearFilters}
                leading={<X className="h-3 w-3" />}
              >
                Clear
              </Button>
            )}
          </div>
        )}
      </form>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {results.map((r) => (
            <SeriesGridCard
              key={r.seriesId ?? `${r.source}:${r.sourceId}`}
              sourceId={r.seriesId ?? r.sourceId}
              title={r.title}
              coverUrl={r.coverUrl}
              type={r.type}
              status={r.status}
              source={r.source}
            />
          ))}
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="py-20 text-center">
          <p className="font-display text-2xl text-text-muted">Nothing by that name.</p>
          <p className="mt-2 font-mono text-xs text-text-faint">
            Try a different term, toggle extra providers, or adjust the filters.
          </p>
        </div>
      )}

      {!loading && !searched && (
        <div className="space-y-10">
          <section>
            <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">
              Browse the stacks
            </p>
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-border-subtle bg-border-subtle sm:grid-cols-3">
              {[
                {
                  label: "Popular",
                  caption: "What the rest of the room is reading.",
                  sort: "Popularity",
                },
                {
                  label: "Latest Updates",
                  caption: "Fresh ink, still drying.",
                  sort: "Latest Updates",
                },
                {
                  label: "Recently Added",
                  caption: "New arrivals to the catalog.",
                  sort: "Recently Added",
                },
              ].map((preset) => (
                <button
                  type="button"
                  key={preset.sort}
                  onClick={() => {
                    setSortFilter(preset.sort);
                    const nextParams = new URLSearchParams({ sort: preset.sort });
                    if (showExtra) nextParams.set("showExtra", "1");
                    router.push(`/search?${nextParams.toString()}`, { scroll: false });
                    doSearch("", { sort: preset.sort });
                  }}
                  className="group flex flex-col items-start gap-1 bg-surface px-5 py-6 text-left transition-colors duration-150 hover:bg-surface-raised"
                >
                  <span className="font-display text-xl leading-none text-text transition-colors group-hover:text-accent">
                    {preset.label}
                  </span>
                  <span className="font-display italic text-sm text-text-faint">
                    {preset.caption}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-faint">
            Or type above to hunt something specific.
          </p>
        </div>
      )}
    </div>
  );
}
