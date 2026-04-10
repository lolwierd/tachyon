"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search as SearchIcon, Loader2, SlidersHorizontal, X } from "lucide-react";
import { SeriesGridCard } from "@/components/series-grid-card";
import { SelectDropdown } from "@/components/ui/select";
import { useNsfw } from "@/lib/nsfw-context";
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
        const json = await res.json() as { results: SearchResult[]; errors: string[] };
        setResults(json.results);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [nsfwEnabled, showExtra, sortFilter, typeFilter, statusFilter],
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
            className="w-full border-b border-border-subtle bg-transparent py-4 pl-8 pr-4 text-base text-text placeholder:text-text-faint transition-colors duration-150 focus:border-accent focus:outline-none"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleToggleExtra}
            className="rounded border border-border-subtle px-2.5 py-1 text-xs font-medium text-text-muted transition-colors hover:border-accent hover:text-accent"
          >
            {showExtra ? "Hide extra providers" : "Show extra providers"}
          </button>
          {!showExtra && (
            <span className="text-xs text-text-faint">Extra providers hidden by default</span>
          )}

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${
              showFilters || hasActiveFilters
                ? "border-accent bg-accent-faint text-accent"
                : "border-border-subtle text-text-muted hover:border-accent hover:text-accent"
            }`}
          >
            <SlidersHorizontal className="h-3 w-3" />
            Filters
            {hasActiveFilters && (
              <span className="ml-0.5 rounded-full bg-accent px-1.5 py-px text-[10px] font-medium text-void">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-sm border border-border-subtle bg-surface p-3">
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
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-xs text-text-faint transition-colors hover:text-accent"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
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
          <p className="font-display text-lg text-text-muted">No results found</p>
          <p className="mt-1 text-sm text-text-faint">Try a different search term or adjust filters.</p>
        </div>
      )}

      {!loading && !searched && (
        <div className="space-y-6">
          <div>
            <p className="mb-3 text-[10px] font-medium uppercase tracking-[0.15em] text-text-faint">
              Browse
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Popular", sort: "Popularity" },
                { label: "Latest Updates", sort: "Latest Updates" },
                { label: "Recently Added", sort: "Recently Added" },
              ].map((preset) => (
                <button
                  key={preset.sort}
                  onClick={() => {
                    setSortFilter(preset.sort);
                    const nextParams = new URLSearchParams({ sort: preset.sort });
                    if (showExtra) nextParams.set("showExtra", "1");
                    router.push(`/search?${nextParams.toString()}`, { scroll: false });
                    doSearch("", { sort: preset.sort });
                  }}
                  className="rounded-sm border border-border px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="py-12 text-center">
            <p className="font-display text-lg text-text-faint">
              Search for manga
            </p>
            <p className="mt-1 text-sm text-text-faint">
              Find manga, manhwa, or comics to add to your library.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
