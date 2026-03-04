import { Suspense } from "react";
import { ReaderView } from "./reader-view";

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ seriesId: string; chapterId: string }>;
}) {
  const { seriesId, chapterId } = await params;

  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-void">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      }
    >
      <ReaderView seriesId={seriesId} chapterId={chapterId} />
    </Suspense>
  );
}
