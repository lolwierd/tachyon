"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search as SearchIcon, Loader2 } from "lucide-react";
import { SeriesGridCard } from "@/components/series-grid-card";
import type { SearchResult } from "@/lib/sources/types";

export function SearchView({
  searchParamsPromise,
}: {
  searchParamsPromise: Promise<{ q?: string }>;
}) {
  const initialParams = use(searchParamsPromise);
  const router = useRouter();
  const params = useSearchParams();
  const initialQuery = params.get("q") || initialParams.q || "";

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) return;
      setLoading(true);
      setSearched(true);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(q.trim())}`,
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
    [],
  );

  useEffect(() => {
    if (initialQuery) {
      doSearch(initialQuery);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/search?q=${encodeURIComponent(query.trim())}`, {
      scroll: false,
    });
    doSearch(query);
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
              key={r.sourceId}
              sourceId={r.sourceId}
              title={r.title}
              coverUrl={r.coverUrl}
              type={r.type}
              status={r.status}
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
