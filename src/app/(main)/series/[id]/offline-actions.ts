import type { DownloadScope } from "@/lib/background/enqueue";
export type { DownloadScope };

type ChapterReadState = "read" | "unread" | "in-progress";

interface ChapterForOfflineAction {
  sourceChapterId: string;
  readState: ChapterReadState;
}

export function getBulkDownloadTargetChapterIds(
  chapters: ChapterForOfflineAction[],
  downloadedChapterIds: Set<string>,
  scope: DownloadScope,
) {
  let chaptersToDownload = chapters.filter(
    (chapter) => !downloadedChapterIds.has(chapter.sourceChapterId),
  );

  if (scope === "unread") {
    chaptersToDownload = chaptersToDownload.filter((chapter) => chapter.readState !== "read");
  } else if (scope === "next5" || scope === "next10" || scope === "next50" || scope === "next100") {
    const limit = scope === "next5" ? 5 : scope === "next10" ? 10 : scope === "next50" ? 50 : 100;
    chaptersToDownload = chaptersToDownload
      .filter((chapter) => chapter.readState !== "read")
      .slice(0, limit);
  }

  return chaptersToDownload.map((chapter) => chapter.sourceChapterId);
}

export function getReadDownloadedChapterIds(
  chapters: ChapterForOfflineAction[],
  downloadedChapterIds: Set<string>,
) {
  return chapters
    .filter(
      (chapter) =>
        chapter.readState === "read" &&
        downloadedChapterIds.has(chapter.sourceChapterId),
    )
    .map((chapter) => chapter.sourceChapterId);
}
