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

function setupFetch(options?: { updateRun?: { status: string; lastError?: string } }) {
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
    const omegascansSeriesPath = buildSeriesApiPath("local-series-1", "omegascans");
    const omegascansChaptersPath = "/api/series/local-series-1/chapters?source=omegascans";
    const mgekoSeriesPath = buildSeriesApiPath("local-series-1", "mgeko");
    const mgekoChaptersPath = "/api/series/local-series-1/chapters?source=mgeko";
    const defaultLibraryPath = "/api/library/local-series-1?source=weebcentral";
    const omegascansLibraryPath = "/api/library/local-series-1?source=omegascans";
    const mgekoLibraryPath = "/api/library/local-series-1?source=mgeko";
    const omegascansOfflinePath = "/api/offline?seriesId=local-series-1&source=omegascans";
    const mgekoOfflinePath = "/api/offline?seriesId=local-series-1&source=mgeko";
    const omegascansPolicyPath = "/api/downloads/policy/local-series-1?source=omegascans";
    const mgekoPolicyPath = "/api/downloads/policy/local-series-1?source=mgeko";
    const omegascansTagsPath = "/api/tags/series/local-series-1?source=omegascans";
    const mgekoTagsPath = "/api/tags/series/local-series-1?source=mgeko";
    const mgekoMarkReadPath = buildSeriesApiPath("local-series-1", "mgeko", "mark-read");

    if (url === "/api/series/local-series-1") return Promise.resolve(jsonResponse(series));
    if (url === omegascansSeriesPath) return Promise.resolve(jsonResponse({ ...series, source: "omegascans" }));
    if (url === mgekoSeriesPath) return Promise.resolve(jsonResponse({ ...series, source: "mgeko" }));
    if (url === "/api/series/local-series-1?refresh=true") return Promise.resolve(jsonResponse(series));
    if (url === "/api/series/local-series-1/chapters") return Promise.resolve(jsonResponse(chapters));
    if (url === omegascansChaptersPath) return Promise.resolve(jsonResponse(chapters));
    if (url === mgekoChaptersPath) return Promise.resolve(jsonResponse(chapters));
    if (url === "/api/series/local-series-1/chapters?refresh=true") return Promise.resolve(jsonResponse(chapters));
    if (url === "/api/series/local-series-1?source=omegascans&refresh=true") return Promise.resolve(jsonResponse({ ...series, source: "omegascans" }));
    if (url === "/api/series/local-series-1/chapters?source=omegascans&refresh=true") return Promise.resolve(jsonResponse(chapters));
    if (
      url === "/api/library/local-series-1" ||
      url === defaultLibraryPath ||
      url === omegascansLibraryPath ||
      url === mgekoLibraryPath
    ) {
      return Promise.resolve(
        jsonResponse({
          status: "planning",
          currentChapterSourceId: null,
          currentPage: null,
        }),
      );
    }
    if ((url === "/api/series/local-series-1/mark-read" || url === mgekoMarkReadPath) && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { read?: boolean };
      return Promise.resolve(jsonResponse({ updated: 1, read: body.read !== false }));
    }
    if (url === "/api/tags") return Promise.resolve(jsonResponse([]));
    if (url === "/api/tags/series/local-series-1" || url === omegascansTagsPath || url === mgekoTagsPath) {
      return Promise.resolve(jsonResponse({ tagIds: [] }));
    }
    if (
      url === "/api/offline?seriesId=local-series-1"
      || url === "/api/offline?seriesId=local-series-1&source=weebcentral"
      || url === omegascansOfflinePath
      || url === mgekoOfflinePath
    ) return Promise.resolve(jsonResponse(offline));
    if (url.startsWith("/api/downloads/runs")) return Promise.resolve(jsonResponse({ runs: [] }));
    if (url === "/api/updates/runs" && init?.method === "POST") {
      return Promise.resolve(jsonResponse({ accepted: true, runId: "update-run-1" }));
    }
    if (url === "/api/updates/runs?runId=update-run-1") {
      return Promise.resolve(jsonResponse({
        runs: [{ id: "update-run-1", ...(options?.updateRun ?? { status: "succeeded" }) }],
      }));
    }
    if (url === "/api/downloads/policy/local-series-1" || url === omegascansPolicyPath || url === mgekoPolicyPath) {
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

    // "Delete read downloads" now lives inside the Download menu.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Download chapters" }));
    await user.click(screen.getByRole("menuitem", { name: /Delete read downloads/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/offline",
      expect.objectContaining({
        method: "POST",
          body: JSON.stringify({
            action: "deleteReadChapters",
            seriesId: "local-series-1",
            source: "weebcentral",
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

  it("renders fetched chapters in numeric order", async () => {
    setupFetch();
    const baseImplementation = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/series/local-series-1/chapters") {
        return Promise.resolve(jsonResponse([
          {
            sourceChapterId: "chapter-61",
            chapterNo: 61,
            title: "Punch 61",
            readState: "unread" as const,
            lastPage: 0,
          },
          {
            sourceChapterId: "chapter-57",
            chapterNo: 57,
            title: "Punch 57",
            readState: "unread" as const,
            lastPage: 0,
          },
          {
            sourceChapterId: "chapter-67-5",
            chapterNo: 67.5,
            title: "Punch 67.5",
            readState: "unread" as const,
            lastPage: 0,
          },
        ]));
      }

      return baseImplementation(input, init);
    });

    const { container } = render(<SeriesView sourceId="local-series-1" />);

    await screen.findByText("Punch 57");

    const chapterRows = Array.from(container.querySelectorAll("[data-chapter-no]"));
    expect(chapterRows.map((row) => row.getAttribute("data-chapter-no"))).toEqual([
      "57",
      "61",
      "67.5",
    ]);
    expect(screen.getByRole("link", { name: "Start reading" })).toHaveAttribute(
      "href",
      buildReaderHref("local-series-1", "chapter-57"),
    );
  });

  it("loads the initial series and chapter data from the source-qualified path", async () => {
    setupFetch();
    render(<SeriesView sourceId="local-series-1" sourceName="omegascans" />);

    await screen.findByText("Test Series");

    expect(fetchMock).toHaveBeenCalledWith(buildSeriesApiPath("local-series-1", "omegascans"));
    expect(fetchMock).toHaveBeenCalledWith("/api/series/local-series-1/chapters?source=omegascans");
  });

  it("queues an update for only the current manga", async () => {
    setupFetch();
    render(<SeriesView sourceId="local-series-1" />);

    await screen.findByText("Test Series");
    const seriesFetchesBefore = fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/series/local-series-1",
    ).length;
    const chapterFetchesBefore = fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/series/local-series-1/chapters",
    ).length;

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Update this manga" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/updates/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seriesId: "local-series-1",
          source: "weebcentral",
        }),
      });
    });
    expect(await screen.findByText("Manga updated")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/series/local-series-1",
    )).toHaveLength(seriesFetchesBefore + 1);
    expect(fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/series/local-series-1/chapters",
    )).toHaveLength(chapterFetchesBefore + 1);
    expect(screen.getByRole("img", { name: "Test Series" }).getAttribute("src")).toContain(
      "/api/media/cover/local-series-1?refresh=true&v=",
    );
  });

  it("shows the worker error when a manga update fails", async () => {
    setupFetch({ updateRun: { status: "failed", lastError: "Source blocked the request" } });
    render(<SeriesView sourceId="local-series-1" />);

    await screen.findByText("Test Series");
    await userEvent.click(screen.getByRole("button", { name: "Update this manga" }));

    expect(await screen.findByText("Source blocked the request")).toBeInTheDocument();
    expect(screen.queryByText("Manga updated")).not.toBeInTheDocument();
  });

  it("loads and saves per-series auto-download policy", async () => {
    setupFetch();
    render(<SeriesView sourceId="local-series-1" />);

    await screen.findByText("Test Series");

    // The limit input is only rendered when auto-download is enabled —
    // there's no reason for a dangling chapter-count field when the
    // feature is off. So we check + enable the toggle first, then read
    // the limit.
    const toggle = screen.getByRole("switch", { name: "Auto-download new chapters" });
    expect(toggle).not.toBeChecked();

    const user = userEvent.setup();
    await user.click(toggle);

    const limit = screen.getByRole("spinbutton", { name: "Auto-download chapter limit" });
    expect(limit).toHaveValue(3);
    fireEvent.change(limit, { target: { value: "7" } });

    // Policy is auto-saved via 800 ms debounce. We don't assert on a
    // "Saved" pill anymore — the success path no longer surfaces one
    // because the switch state IS the confirmation. A happy save is
    // silent; only errors say anything.
    await waitFor(
      () => {
        expect(fetchMock).toHaveBeenCalledWith(
          "/api/downloads/policy/local-series-1",
          expect.objectContaining({
            method: "PUT",
            body: JSON.stringify({
              source: "weebcentral",
              autoDownloadNewEnabled: true,
              autoDownloadNewLimit: 7,
            }),
          }),
        );
      },
      { timeout: 2000 },
    );
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

    const toggle = screen.getByRole("switch", { name: "Auto-download new chapters" });
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

  it("marks only unread chapters up to the selected chapter", async () => {
    setupFetch();
    const baseImplementation = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/series/local-series-1/mark-read" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ updated: 2, read: true }));
      }
      return baseImplementation(input, init);
    });

    render(<SeriesView sourceId="local-series-1" />);
    await screen.findByText("Test Series");

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Chapter actions" })[1]!);
    await user.click(screen.getByRole("button", { name: "Mark up to here as read" }));

    await waitFor(() => {
      const markReadCalls = fetchMock.mock.calls.filter(
        ([url, init]) => String(url) === "/api/series/local-series-1/mark-read" && init?.method === "POST",
      );
      expect(markReadCalls).toHaveLength(1);
      expect(markReadCalls[0]?.[1]).toEqual(expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ chapterIds: ["chapter-2", "chapter-3"], read: true }),
      }));
    });
  });

  it("puts the provider query after the mark-read action path", async () => {
    setupFetch();
    render(<SeriesView sourceId="local-series-1" sourceName="mgeko" />);
    await screen.findByText("Test Series");

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Chapter actions" })[1]!);
    await user.click(screen.getByRole("button", { name: "Mark up to here as read" }));

    await waitFor(() => {
      const markReadCalls = fetchMock.mock.calls.filter(
        ([url, init]) => String(url) === "/api/series/local-series-1/mark-read?source=mgeko" && init?.method === "POST",
      );
      expect(markReadCalls).toHaveLength(1);
      expect(markReadCalls[0]?.[1]).toEqual(expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ chapterIds: ["chapter-2", "chapter-3"], read: true }),
      }));
    });
  });

  it("lets you move a series between reading and caught up from the series header", async () => {
    setupFetch();
    const baseImplementation = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/library/local-series-1")) {
        return Promise.resolve(
          jsonResponse({
            status: "reading",
            currentChapterSourceId: null,
            currentPage: null,
          }),
        );
      }
      if (url === "/api/series/local-series-1/mark-read" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { read?: boolean };
        return Promise.resolve(jsonResponse({ updated: 3, read: body.read !== false }));
      }
      return baseImplementation(input, init);
    });

    render(<SeriesView sourceId="local-series-1" />);
    await screen.findByText("Test Series");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mark caught up" }));

    await waitFor(() => {
      const markReadCalls = fetchMock.mock.calls.filter(
        ([url, init]) => String(url) === "/api/series/local-series-1/mark-read" && init?.method === "POST",
      );
      expect(markReadCalls).toHaveLength(1);
      expect(markReadCalls[0]?.[1]).toEqual(expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          chapterIds: ["chapter-2", "chapter-3"],
          read: true,
        }),
      }));
    });
    await screen.findByRole("button", { name: "Move to reading" });

    await user.click(screen.getByRole("button", { name: "Move to reading" }));

    await waitFor(() => {
      const markReadCalls = fetchMock.mock.calls.filter(
        ([url, init]) => String(url) === "/api/series/local-series-1/mark-read" && init?.method === "POST",
      );
      expect(markReadCalls).toHaveLength(2);
      expect(markReadCalls[1]?.[1]).toEqual(expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ chapterIds: ["chapter-3"], read: false }),
      }));
    });
  });

  it("marks only non-unread chapters up to the selected chapter as unread", async () => {
    setupFetch();

    render(<SeriesView sourceId="local-series-1" />);
    await screen.findByText("Test Series");

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Chapter actions" })[1]!);
    await user.click(screen.getByRole("button", { name: "Mark up to here as unread" }));

    await waitFor(() => {
      const markReadCalls = fetchMock.mock.calls.filter(
        ([url, init]) => String(url) === "/api/series/local-series-1/mark-read" && init?.method === "POST",
      );
      expect(markReadCalls).toHaveLength(1);
      expect(markReadCalls[0]?.[1]).toEqual(expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ chapterIds: ["chapter-1", "chapter-3"], read: false }),
      }));
    });
  });

  it("shows mark-read API errors in a toast", async () => {
    setupFetch();
    const baseImplementation = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/series/local-series-1/mark-read" && init?.method === "POST") {
        return Promise.resolve({
          ok: false,
          json: vi.fn().mockResolvedValue({
            error: "Invalid request body",
            details: [{ message: "Too big: expected array to have <=500 items" }],
          }),
        });
      }
      return baseImplementation(input, init);
    });

    render(<SeriesView sourceId="local-series-1" />);
    await screen.findByText("Test Series");

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Chapter actions" })[0]!);
    await user.click(screen.getByRole("button", { name: "Mark as read" }));

    await screen.findByText("Too big: expected array to have <=500 items");
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

    // For adult series the status button is replaced by a minimal
    // library-actions menu that still exposes Remove / Move.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Library actions" }));
    expect(screen.getByRole("menuitem", { name: /Remove from library/i })).toBeInTheDocument();
  });

  it("shows the move-to-nsfw action only when NSFW mode is enabled", async () => {
    setupFetch();
    useNsfwMock.mockReturnValue({ nsfwEnabled: true });

    render(<SeriesView sourceId="local-series-1" />);

    await screen.findByText("Test Series");
    // Move-to-NSFW now lives inside the library-status dropdown.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Library status/i }));
    expect(screen.getByRole("menuitem", { name: "Move to NSFW" })).toBeInTheDocument();
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
    // Open the library-status menu, click the NSFW toggle. Menu closes on click.
    await user.click(screen.getByRole("button", { name: /Library status/i }));
    await user.click(screen.getByRole("menuitem", { name: "Move to NSFW" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/library/local-series-1?source=weebcentral",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ adult: true, nsfwEnabled: true }),
      }),
    );
    await screen.findByText("Moved to NSFW");
    // Once the series is adult, the trigger collapses to "Library actions"
    // with just Move / Remove. Re-open to confirm the label flipped.
    await user.click(screen.getByRole("button", { name: "Library actions" }));
    expect(screen.getByRole("menuitem", { name: "Move to Main" })).toBeInTheDocument();
  });
});
