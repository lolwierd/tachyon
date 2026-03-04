/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SeriesView } from "./series-view";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & { src?: string }) => (
    <img alt={alt} src={src} {...props} />
  ),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const series = {
  sourceId: "series-1",
  title: "Test Series",
  slug: "test-series",
  coverUrl: "/cover.jpg",
  description: "A series used for testing.",
  authors: ["Author"],
  tags: ["Action"],
  type: "manga",
  status: "ongoing",
  year: 2024,
  isAdult: false,
  isOfficial: false,
  anilistUrl: null,
  relatedSeries: [],
};

const chapters = [
  {
    sourceChapterId: "chapter-1",
    chapterNo: 1,
    title: "Chapter 1",
    readState: "read" as const,
    lastPage: 0,
  },
  {
    sourceChapterId: "chapter-2",
    chapterNo: 2,
    title: "Chapter 2",
    readState: "unread" as const,
    lastPage: 0,
  },
];

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(payload),
  };
}

function setupFetch() {
  let offline = {
    storage: {
      cacheBytes: 120,
      cachedFiles: 12,
      pinnedBytes: 120,
      pinnedChapters: 1,
    },
    chapters: [
      {
        sourceChapterId: "chapter-1",
        pinned: true,
        state: "ready" as const,
      },
    ],
  };

  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url === "/api/series/series-1") return Promise.resolve(jsonResponse(series));
    if (url === "/api/series/series-1?refresh=true") return Promise.resolve(jsonResponse(series));
    if (url === "/api/series/series-1/chapters") return Promise.resolve(jsonResponse(chapters));
    if (url === "/api/series/series-1/chapters?refresh=true") return Promise.resolve(jsonResponse(chapters));
    if (url === "/api/library/series-1") {
      return Promise.resolve(
        jsonResponse({
          status: "planning",
          currentChapterSourceId: null,
          currentPage: null,
        }),
      );
    }
    if (url === "/api/collections") return Promise.resolve(jsonResponse([]));
    if (url === "/api/collections/series/series-1") {
      return Promise.resolve(jsonResponse({ collectionIds: [] }));
    }
    if (url === "/api/tags") return Promise.resolve(jsonResponse([]));
    if (url === "/api/tags/series/series-1") return Promise.resolve(jsonResponse({ tagIds: [] }));
    if (url === "/api/offline?seriesId=series-1") return Promise.resolve(jsonResponse(offline));

    if (url === "/api/offline" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as {
        action: string;
        chapterId?: string;
      };

      if (body.action === "pinChapter") {
        offline = {
          ...offline,
          storage: {
            ...offline.storage,
            pinnedChapters: 2,
          },
          chapters: [
            ...offline.chapters,
            {
              sourceChapterId: body.chapterId ?? "chapter-2",
              pinned: true,
              state: "ready",
            },
          ],
        };

        return Promise.resolve(jsonResponse({ sourceChapterId: body.chapterId, state: "ready" }));
      }

      if (body.action === "deleteReadChapters") {
        offline = {
          ...offline,
          storage: {
            ...offline.storage,
            pinnedChapters: 0,
          },
          chapters: [],
        };

        return Promise.resolve(
          jsonResponse({
            sourceSeriesId: "series-1",
            requested: 1,
            deleted: 1,
            removedFiles: 8,
            failures: [],
          }),
        );
      }
    }

    throw new Error(`Unhandled fetch: ${url}`);
  });
}

describe("SeriesView", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    window.localStorage.clear();
  });

  it("shows a downloading badge beside the chapter being downloaded", async () => {
    setupFetch();

    let resolveDownload: (() => void) | null = null;
    const baseImplementation = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/offline" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action: string };
        if (body.action === "pinChapter") {
          return new Promise((resolve) => {
            resolveDownload = () => {
              void baseImplementation(input, init).then(resolve);
            };
          });
        }
      }
      return baseImplementation(input, init);
    });

    render(<SeriesView sourceId="series-1" />);

    await screen.findByText("Test Series");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Download chapter" }));

    expect(screen.getAllByText("Downloading").length).toBeGreaterThan(0);

    resolveDownload?.();

    await waitFor(() => {
      expect(screen.queryByText("Downloading")).not.toBeInTheDocument();
    });
    expect(screen.getAllByRole("button", { name: "Remove download" }).length).toBeGreaterThan(0);
  });

  it("posts the delete read chapters action from the series page", async () => {
    setupFetch();
    render(<SeriesView sourceId="series-1" />);

    await screen.findByText("Test Series");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete read (1)" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/offline",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "deleteReadChapters",
          seriesId: "series-1",
        }),
      }),
    );
  });

  it("defaults chapter filter to unread and persists per-series filter", async () => {
    setupFetch();
    render(<SeriesView sourceId="series-1" />);

    await screen.findByText("Test Series");
    await screen.findByText("Chapter 2");
    expect(screen.queryByText("Chapter 1")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Read" }));
    await screen.findByText("Chapter 1");
    expect(screen.queryByText("Chapter 2")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("series:series-1:chapter-filter")).toBe("read");
  });

  it("forces cover refresh after series refresh", async () => {
    setupFetch();
    render(<SeriesView sourceId="series-1" />);

    await screen.findByText("Test Series");
    const coverBefore = screen.getByRole("img", { name: "Test Series" });
    expect(coverBefore).toHaveAttribute("src", "/api/media/cover/series-1");

    const user = userEvent.setup();
    await user.click(screen.getByTitle("Refresh from source"));

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Test Series" }).getAttribute("src")).toContain(
        "/api/media/cover/series-1?refresh=true&v=",
      );
    });
  });
});
