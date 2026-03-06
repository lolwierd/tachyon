import { Suspense } from "react";
import { decodeReaderSegment } from "@/lib/reader/url";
import { ReaderView } from "./reader-view";

export default async function ReaderPage({
  params,
  searchParams,
}: {
  params: Promise<{ seriesId: string; chapterId: string[] }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { seriesId, chapterId: chapterSegments } = await params;
  const { source } = await searchParams;
  const chapterId = decodeReaderSegment(chapterSegments.join("/"));
  const decodedSeriesId = decodeReaderSegment(seriesId);

  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-void">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      }
    >
      <ReaderView seriesId={decodedSeriesId} seriesSource={source ?? null} chapterId={chapterId} />
    </Suspense>
  );
}
