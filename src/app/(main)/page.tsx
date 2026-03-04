import Link from "next/link";
import { Search, BookOpen } from "lucide-react";

export default function HomePage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-8 text-center">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight text-text">Reader</h1>
        <p className="max-w-md text-text-muted">
          A private reading sanctuary for manga, manhwa, and comics.
        </p>
      </div>

      <div className="flex gap-3">
        <Link
          href="/search"
          className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-void transition-colors hover:bg-accent-muted"
        >
          <Search className="h-4 w-4" />
          Search
        </Link>
        <Link
          href="/library"
          className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-5 py-2.5 text-sm font-medium text-text transition-colors hover:border-accent-muted hover:text-accent"
        >
          <BookOpen className="h-4 w-4" />
          Library
        </Link>
      </div>
    </div>
  );
}
