import { Suspense } from "react";
import { SeriesView } from "./series-view";
import { Skeleton } from "@/components/ui/skeleton";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Series — Reader`, description: `Series ${id}` };
}

function SeriesLoading() {
  return (
    <div className="space-y-6">
      <div className="flex gap-6">
        <Skeleton className="h-72 w-48 shrink-0 rounded-xl" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export default async function SeriesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <Suspense fallback={<SeriesLoading />}>
      <SeriesView sourceId={id} />
    </Suspense>
  );
}
