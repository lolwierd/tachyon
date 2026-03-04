import { BookOpen } from "lucide-react";

export const metadata = {
  title: "Library — Reader",
};

export default function LibraryPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <BookOpen className="h-12 w-12 text-text-faint" />
      <div>
        <h1 className="text-xl font-semibold text-text">Your Library</h1>
        <p className="mt-1 text-sm text-text-muted">
          Add series from search to build your personal collection.
        </p>
      </div>
    </div>
  );
}
