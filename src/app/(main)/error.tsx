"use client";

import { useEffect } from "react";

export default function MainError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Main layout error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h2 className="font-display text-2xl text-text">Something went wrong</h2>
      <p className="max-w-sm text-sm text-text-muted">
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        onClick={reset}
        className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-[color:var(--color-text-on-accent)] transition-colors hover:bg-accent-muted"
      >
        Try again
      </button>
    </div>
  );
}
