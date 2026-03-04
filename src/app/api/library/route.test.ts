import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listLibraryEntriesMock = vi.fn();
const upsertLibraryEntryMock = vi.fn();

vi.mock("@/lib/library/state", () => ({
  listLibraryEntries: listLibraryEntriesMock,
  upsertLibraryEntry: upsertLibraryEntryMock,
}));

describe("library collection API", () => {
  beforeEach(() => {
    listLibraryEntriesMock.mockReset();
    upsertLibraryEntryMock.mockReset();
  });

  it("returns the current library entries", async () => {
    listLibraryEntriesMock.mockReturnValue([{ sourceSeriesId: "series-1" }]);

    const { GET } = await import("./route");
    const response = await GET();

    expect(listLibraryEntriesMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual([{ sourceSeriesId: "series-1" }]);
  });

  it("validates POST bodies", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/library", {
        method: "POST",
        body: JSON.stringify({ seriesId: "series-1" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "seriesId and status are required",
    });
  });

  it("upserts a library entry from POST", async () => {
    upsertLibraryEntryMock.mockResolvedValue({ sourceSeriesId: "series-1", status: "planning" });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/library", {
        method: "POST",
        body: JSON.stringify({
          seriesId: "series-1",
          status: "planning",
          series: {
            sourceId: "series-1",
            title: "Series One",
            slug: "series-one",
            coverUrl: "cover.jpg",
            description: "desc",
            authors: [],
            tags: [],
            type: "Manga",
            status: "Ongoing",
            year: 2024,
            isAdult: false,
            isOfficial: false,
            anilistUrl: null,
            relatedSeries: [],
          },
          chapters: [
            {
              sourceChapterId: "ch-1",
              chapterNo: 1,
              title: "Chapter 1",
            },
          ],
        }),
      }),
    );

    expect(upsertLibraryEntryMock).toHaveBeenCalledWith({
      sourceSeriesId: "series-1",
      status: "planning",
      seriesDetail: expect.objectContaining({
        sourceId: "series-1",
        title: "Series One",
      }),
      chapters: [
        {
          sourceChapterId: "ch-1",
          chapterNo: 1,
          title: "Chapter 1",
        },
      ],
    });
    await expect(response.json()).resolves.toEqual({
      sourceSeriesId: "series-1",
      status: "planning",
    });
  });
});
