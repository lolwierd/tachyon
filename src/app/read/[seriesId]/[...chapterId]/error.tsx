"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ReaderError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Reader error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-void text-center">
      <h2 className="font-display text-2xl text-text">Reader Error</h2>
      <p className="max-w-sm text-sm text-text-muted">
        {error.message || "Failed to load the reader."}
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-[color:var(--color-text-on-accent)] transition-colors hover:bg-accent-muted"
        >
          Retry
        </button>
        <Link
          href="/"
          className="rounded-sm border border-border px-4 py-2 text-sm text-text-muted transition-colors hover:border-accent hover:text-accent"
        >
          Back to Library
        </Link>
      </div>
    </div>
  );
}
