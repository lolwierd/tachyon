/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildReaderHref, buildSeriesApiPath } from "@/lib/reader/url";
import { SeriesView } from "./series-view";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ fill, priority, unoptimized, ...props }: ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    priority?: boolean;
    unoptimized?: boolean;
  }) => {
    void fill;
    void priority;
    void unoptimized;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={props.alt ?? ""} {...props} />;
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const useNsfwMock = vi.fn(() => ({ nsfwEnabled: false }));
vi.mock("@/lib/nsfw-context", () => ({
  useNsfw: () => useNsfwMock(),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const series = {
  seriesId: "local-series-1",
  sourceId: "series-1",
  source: "weebcentral",
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
  {
    sourceChapterId: "chapter-3",
    chapterNo: 3,
    title: "Chapter 3",
    readState: "in-progress" as const,
    lastPage: 4,
  },
];

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(payload),
  };
}

function setupFetch() {
  let policy = {
    sourceSeriesId: "series-1",
    autoDownloadNewEnabled: false,
    autoDownloadNewLimit: 3,
  };
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
    const comixSeriesPath = buildSeriesApiPath("local-series-1", "comix");
    const comixChaptersPath = "/api/series/local-series-1/chapters?source=comix";
    const defaultLibraryPath = "/api/library/local-series-1?source=weebcentral";
    const comixLibraryPath = "/api/library/local-series-1?source=comix";

    if (url === "/api/series/local-series-1") return Promise.resolve(jsonResponse(series));
    if (url === comixSeriesPath) return Promise.resolve(jsonResponse({ ...series, source: "comix" }));
    if (url === "/api/series/local-series-1?refresh=true") return Promise.resolve(jsonResponse(series));
    if (url === "/api/series/local-series-1/chapters") return Promise.resolve(jsonResponse(chapters));
    if (url === comixChaptersPath) return Promise.resolve(jsonResponse(chapters));
    if (url === "/api/series/local-series-1/chapters?refresh=true") return Promise.resolve(jsonResponse(chapters));
    if (url === "/api/series/local-series-1?source=comix&refresh=true") return Promise.resolve(jsonResponse({ ...series, source: "comix" }));
    if (url === "/api/series/local-series-1/chapters?source=comix&refresh=true") return Promise.resolve(jsonResponse(chapters));
    if (
      url === "/api/library/local-series-1" ||
      url === defaultLibraryPath ||
      url === comixLibraryPath
    ) {
      return Promise.resolve(
        jsonResponse({
          status: "planning",
          currentChapterSourceId: null,
          currentPage: null,
        }),
      );
    }
    if (url === "/api/tags") return Promise.resolve(jsonResponse([]));
    if (url === "/api/tags/series/local-series-1") return Promise.resolve(jsonResponse({ tagIds: [] }));
    if (url === "/api/offline?seriesId=local-series-1") return Promise.resolve(jsonResponse(offline));
    if (url.startsWith("/api/downloads/runs")) return Promise.resolve(jsonResponse({ runs: [] }));
    if (url === "/api/downloads/policy/local-series-1") {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as {
          autoDownloadNewEnabled: boolean;
          autoDownloadNewLimit: number;
        };
        policy = {
          ...policy,
          autoDownloadNewEnabled: body.autoDownloadNewEnabled,
          autoDownloadNewLimit: body.autoDownloadNewLimit,
        };
        return Promise.resolve(jsonResponse(policy));
      }
      return Promise.resolve(jsonResponse(policy));
    }

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
    useNsfwMock.mockReset();
    useNsfwMock.mockReturnValue({ nsfwEnabled: false });
    window.localStorage.clear();
  });

  it("shows a downloading badge beside the chapter being downloaded", async () => {
    setupFetch();

    const deferred: { resolve: (() => void) | null } = { resolve: null };
    const baseImplementation = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/offline" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action: string };
        if (body.action === "pinChapter") {
          return new Promise((resolve) => {
            deferred.resolve = () => {
              void baseImplementation(input, init).then(resolve);
            };
          });
        }
      }
      return baseImplementation(input, init);
    });

    render(<SeriesView sourceId="local-series-1" />);

    await screen.findByText("Test Series");

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Download chapter" })[0]!);

    expect(screen.getAllByText("Downloading").length).toBeGreaterThan(0);

    deferred.resolve?.();

    await waitFor(() => {
      expect(screen.queryByText("Downloading")).not.toBeInTheDocument();
    });
    expect(screen.getAllByRole("button", { name: "Remove download" }).length).toBeGreaterThan(0);
  });

  it("posts the delete read chapters action from the series page", async () => {
    setupFetch();
    render(<SeriesView sourceId="local-series-1" />);

    await screen.findByText("Test Series");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Delete read (1)" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/offline",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "deleteReadChapters",
          seriesId: "local-series-1",
          keepLastN: 0,
        }),
      }),
    );
  });

  it("defaults chapter filter to unread and persists per-series filter", async () => {
    setupFetch();
    render(<SeriesView sourceId="local-series-1" />);

    await screen.findByText("Test Series");
    await screen.findByText("Chapter 2");
    await screen.findByText("Chapter 3");
    expect(screen.queryByText("Chapter 1")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Read" }));
    await screen.findByText("Chapter 1");
    expect(screen.queryByText("Chapter 2")).not.toBeInTheDocument();
    expect(screen.queryByText("Chapter 3")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("series:local-series-1:chapter-filter")).toBe("read");
  });

  it("starts reading from the first chapter with an opaque reader url", async () => {
    setupFetch();
    render(<SeriesView sourceId="local-series-1" />);

    const startLink = await screen.findByRole("link", { name: "Start reading" });
    expect(startLink).toHaveAttribute("href", buildReaderHref("local-series-1", "chapter-1"));
  });

  it("loads the initial series and chapter data from the source-qualified path", async () => {
    setupFetch();
    render(<SeriesView sourceId="local-series-1" sourceName="comix" />);

    await screen.findByText("Test Series");

    expect(fetchMock).toHaveBeenCalledWith(buildSeriesApiPath("local-series-1", "comix"));
    expect(fetchMock).toHaveBeenCalledWith("/api/series/local-series-1/chapters?source=comix");
  });

  it("forces cover refresh after series refresh", async () => {
    setupFetch();
    render(<SeriesView sourceId="local-series-1" />);

    await screen.findByText("Test Series");
    const coverBefore = screen.getByRole("img", { name: "Test Series" });
    expect(coverBefore).toHaveAttribute("src", "/api/media/cover/local-series-1");

    const user = userEvent.setup();
    await user.click(screen.getByTitle("Refresh from source"));

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Test Series" }).getAttribute("src")).toContain(
        "/api/media/cover/local-series-1?refresh=true&v=",
      );
    });
  });

  it("loads and saves per-series auto-download policy", async () => {
    setupFetch();
    render(<SeriesView sourceId="local-series-1" />);

    await screen.findByText("Test Series");

    const toggle = screen.getByRole("checkbox", { name: "Auto-download new chapters" });
    const limit = screen.getByRole("spinbutton", { name: "Auto-download chapter limit" });
    expect(toggle).not.toBeChecked();
    expect(limit).toHaveValue(3);

    const user = userEvent.setup();
    await user.click(toggle);
    fireEvent.change(limit, { target: { value: "7" } });

    // policy is auto-saved via 800 ms debounce
    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/downloads/policy/local-series-1",
          expect.objectContaining({
            method: "PUT",
            body: JSON.stringify({
              autoDownloadNewEnabled: true,
              autoDownloadNewLimit: 7,
            }),
          }),
        );
      },
      { timeout: 2000 },
    );
    await screen.findByText("Saved", { selector: "span" });
  });

  it("shows an error when per-series policy save fails", async () => {
    setupFetch();
    const baseImplementation = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/downloads/policy/local-series-1" && init?.method === "PUT") {
        return Promise.resolve({
          ok: false,
          json: vi.fn().mockResolvedValue({ error: "failed" }),
        });
      }
      return baseImplementation(input, init);
    });

    render(<SeriesView sourceId="local-series-1" />);
    await screen.findByText("Test Series");

    const toggle = screen.getByRole("checkbox", { name: "Auto-download new chapters" });
    const user = userEvent.setup();
    await user.click(toggle);

    // policy is auto-saved via 800 ms debounce; wait for error text
    await screen.findByText("Failed to save", { selector: "span" }, { timeout: 2000 });
  });

  it("shows a toast after a bulk download is triggered", async () => {
    setupFetch();
    const baseImplementation = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/offline" && (init as RequestInit | undefined)?.method === "POST") {
        const body = JSON.parse(String((init as RequestInit).body)) as { action: string };
        if (body.action === "downloadBulk") {
          return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({}) });
        }
      }
      return baseImplementation(input, init);
    });

    render(<SeriesView sourceId="local-series-1" />);
    await screen.findByText("Test Series");

    const user = userEvent.setup();
    // Open the download dropdown
    await user.click(screen.getByTitle("Download chapters"));
    // Click "Download all"
    await user.click(screen.getByText("Download all"));

    // Toast should appear with a chapter count
    await screen.findByText(/Queued \d+ chapter/);
  });

  it("hides library status buckets for NSFW series that are not in the library", async () => {
    setupFetch();
    const baseImplementation = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/series/local-series-1") {
        return Promise.resolve(jsonResponse({ ...series, isAdult: true }));
      }
      if (url.startsWith("/api/library/local-series-1")) {
        return Promise.resolve({
          ok: false,
          json: vi.fn().mockResolvedValue({ error: "Library entry not found" }),
        });
      }
      return baseImplementation(input, init);
    });

    render(<SeriesView sourceId="local-series-1" />);

    await screen.findByText("Test Series");
    expect(screen.queryByRole("combobox", { name: "Library status" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to Library" })).toBeInTheDocument();
  });

  it("hides library status buckets for NSFW series already in the library", async () => {
    setupFetch();
    const baseImplementation = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/series/local-series-1") {
        return Promise.resolve(jsonResponse({ ...series, isAdult: true }));
      }
      if (url.startsWith("/api/library/local-series-1")) {
        return Promise.resolve(
          jsonResponse({
            status: "reading",
            currentChapterSourceId: null,
            currentPage: null,
          }),
        );
      }
      return baseImplementation(input, init);
    });

    render(<SeriesView sourceId="local-series-1" />);

    await screen.findByText("Test Series");
    expect(screen.queryByRole("combobox", { name: "Library status" })).not.toBeInTheDocument();
    expect(screen.getByText("In library")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Remove/i })).toBeInTheDocument();
  });

  it("shows the move-to-nsfw action only when NSFW mode is enabled", async () => {
    setupFetch();
    useNsfwMock.mockReturnValue({ nsfwEnabled: true });

    render(<SeriesView sourceId="local-series-1" />);

    await screen.findByText("Test Series");
    expect(screen.getByRole("button", { name: "Move to NSFW" })).toBeInTheDocument();
  });

  it("moves a library series into the NSFW bucket when NSFW mode is enabled", async () => {
    setupFetch();
    useNsfwMock.mockReturnValue({ nsfwEnabled: true });
    const baseImplementation = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/library/local-series-1") && init?.method === "PATCH") {
        return Promise.resolve(jsonResponse({
          status: "planning",
          currentChapterSourceId: null,
          currentPage: null,
          adult: true,
        }));
      }
      return baseImplementation(input, init);
    });

    render(<SeriesView sourceId="local-series-1" />);
    await screen.findByText("Test Series");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Move to NSFW" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/library/local-series-1?source=weebcentral",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ adult: true, nsfwEnabled: true }),
      }),
    );
    await screen.findByText("Moved to NSFW");
    expect(screen.getByRole("button", { name: "Move to Main" })).toBeInTheDocument();
  });
});
