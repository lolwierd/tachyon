"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search as SearchIcon, Loader2 } from "lucide-react";
import { SeriesCard } from "@/components/series-card";
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
          `/api/search?q=${encodeURIComponent(q.trim())}`
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
    []
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
      <form onSubmit={handleSubmit} className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-faint" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search manga, manhwa, comics…"
          className="w-full rounded-xl border border-border bg-surface py-3.5 pl-12 pr-4 text-text placeholder:text-text-faint focus:border-accent-muted focus:outline-none focus:ring-1 focus:ring-accent-muted"
          autoFocus
        />
      </form>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {results.map((r) => (
            <SeriesCard
              key={r.sourceId}
              sourceId={r.sourceId}
              title={r.title}
              coverUrl={r.coverUrl}
              type={r.type}
              status={r.status}
              year={r.year ?? undefined}
              authors={r.authors}
              tags={r.tags}
            />
          ))}
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="py-20 text-center text-text-muted">
          No results found. Try a different search.
        </div>
      )}

      {!loading && !searched && (
        <div className="py-20 text-center text-text-faint">
          Search for a manga, manhwa, or comic to get started.
        </div>
      )}
    </div>
  );
}
