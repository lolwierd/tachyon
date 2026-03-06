"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search as SearchIcon, Loader2 } from "lucide-react";
import { SeriesGridCard } from "@/components/series-grid-card";
import { useNsfw } from "@/lib/nsfw-context";
import type { SearchResult } from "@/lib/sources/types";

export function SearchView({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<{ q?: string; showMadaradex?: string }>;
}) {
  const initialParams = use(searchParamsPromise);
  const router = useRouter();
  const params = useSearchParams();
  const { nsfwEnabled } = useNsfw();
  const initialQuery = params.get("q") || initialParams.q || "";
  const initialShowMadaradex =
    (params.get("showMadaradex") || initialParams.showMadaradex || "") === "1";

  const [query, setQuery] = useState(initialQuery);
  const [showMadaradex, setShowMadaradex] = useState(initialShowMadaradex);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = useCallback(
    async (q: string, options?: { showMadaradex?: boolean }) => {
      if (!q.trim()) return;
      setLoading(true);
      setSearched(true);
      try {
        const nsfwParam = nsfwEnabled ? "&nsfw=1" : "";
        const shouldShowMadaradex = options?.showMadaradex ?? showMadaradex;
        const madaradexParam = shouldShowMadaradex ? "&showMadaradex=1" : "";
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q.trim())}${nsfwParam}${madaradexParam}`,
        );
        if (!res.ok) throw new Error("Search failed");
        const data: SearchResult[] = await res.json();
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [nsfwEnabled, showMadaradex],
  );

  useEffect(() => {
    if (initialQuery) {
      doSearch(initialQuery);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    const nextParams = new URLSearchParams({ q: query.trim() });
    if (showMadaradex) {
      nextParams.set("showMadaradex", "1");
    }
    router.push(`/search?${nextParams.toString()}`, {
      scroll: false,
    });
    doSearch(query);
  }

  function handleToggleMadaradex() {
    const nextShowMadaradex = !showMadaradex;
    setShowMadaradex(nextShowMadaradex);

    if (!query.trim()) {
      return;
    }

    const nextParams = new URLSearchParams({ q: query.trim() });
    if (nextShowMadaradex) {
      nextParams.set("showMadaradex", "1");
    }

    router.replace(`/search?${nextParams.toString()}`, {
      scroll: false,
    });
    doSearch(query, { showMadaradex: nextShowMadaradex });
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

        {nsfwEnabled && (
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handleToggleMadaradex}
              className="rounded border border-border-subtle px-2.5 py-1 text-xs font-medium text-text-muted transition-colors hover:border-accent hover:text-accent"
            >
              {showMadaradex ? "Hide MadaraDex" : "Show MadaraDex"}
            </button>
            {!showMadaradex && (
              <span className="text-xs text-text-faint">MadaraDex hidden by default</span>
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
          <p className="mt-1 text-sm text-text-faint">Try a different search term.</p>
        </div>
      )}

      {!loading && !searched && (
        <div className="py-20 text-center">
          <p className="font-display text-lg text-text-faint">
            Search for manga
          </p>
          <p className="mt-1 text-sm text-text-faint">
            Find manga, manhwa, or comics to add to your library.
          </p>
        </div>
      )}
    </div>
  );
}
