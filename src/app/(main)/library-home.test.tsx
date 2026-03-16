/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryHome } from "./library-home";
import { buildReaderHref, buildSeriesHref } from "@/lib/reader/url";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
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

let nsfwEnabledValue = false;
vi.mock("@/lib/nsfw-context", () => ({
  useNsfw: () => ({
    nsfwEnabled: nsfwEnabledValue,
    setNsfwEnabled: vi.fn(),
  }),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const entries = [
  {
    seriesId: "local-series-a",
    sourceSeriesId: "series-a",
    source: "weebcentral",
    title: "Alpha",
    coverUrl: null,
    status: "reading",
    addedAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-04T00:00:00.000Z",
    currentPage: 0,
    progressUpdatedAt: "2026-01-02T00:00:00.000Z",
    currentChapterSourceId: null,
    currentChapterTitle: null,
    totalChapters: 20,
    completedChapters: 9,
    unreadChapters: 11,
    downloadedChapters: 1,
    lastCompletedAt: null,
    lastCompletedChapterSourceId: null,
    lastCompletedChapterTitle: null,
    tagIds: [],
    adult: false,
  },
  {
    seriesId: "local-series-b",
    sourceSeriesId: "series-b",
    source: "comix",
    title: "Beta",
    coverUrl: null,
    status: "reading",
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    currentPage: 0,
    progressUpdatedAt: "2026-01-04T00:00:00.000Z",
    currentChapterSourceId: null,
    currentChapterTitle: null,
    totalChapters: 10,
    completedChapters: 8,
    unreadChapters: 2,
    downloadedChapters: 5,
    lastCompletedAt: null,
    lastCompletedChapterSourceId: null,
    lastCompletedChapterTitle: null,
    tagIds: [],
    adult: false,
  },
];

describe("LibraryHome", () => {
  beforeEach(() => {
    nsfwEnabledValue = false;
    fetchMock.mockReset();
    window.localStorage.clear();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/library") return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(entries) });
      if (url === "/api/library?nsfw=1") return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(entries) });
      if (url === "/api/tags") return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue([]) });
      if (url === "/api/library/refresh") return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({}) });
      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  it("shows unread badges and provides asc/desc sort options", async () => {
    render(<LibraryHome />);
    await screen.findByText("Alpha");

    expect(screen.getByText("11")).toBeInTheDocument();
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);

    const sortSelect = screen.getByRole("combobox");
    for (const option of [
      "Last read ↓",
      "Last read ↑",
      "Unread ↓",
      "Unread ↑",
      "Downloaded ↓",
      "Downloaded ↑",
      "Added ↓",
      "Added ↑",
    ]) {
      expect(screen.getByRole("option", { name: option })).toBeInTheDocument();
    }

    const user = userEvent.setup();
    await user.selectOptions(sortSelect, "downloaded-desc");
    await waitFor(() => {
      const links = Array.from(
        document.querySelectorAll('a[href^="/series/"]'),
      ) as HTMLAnchorElement[];
      expect(links[0]?.getAttribute("href")).toBe(buildSeriesHref("local-series-b", "comix"));
    });

    await user.selectOptions(sortSelect, "downloaded-asc");
    await waitFor(() => {
      const links = Array.from(
        document.querySelectorAll('a[href^="/series/"]'),
      ) as HTMLAnchorElement[];
      expect(links[0]?.getAttribute("href")).toBe(buildSeriesHref("local-series-a", "weebcentral"));
    });
  });

  it("appends cover cache-busting token after refresh", async () => {
    render(<LibraryHome />);
    await screen.findByText("Alpha");

    const coverBefore = screen.getByRole("img", { name: "Alpha" });
    expect(coverBefore.getAttribute("src")).toBe("/api/media/cover/local-series-a");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Alpha" }).getAttribute("src")).toContain(
        "/api/media/cover/local-series-a?v=",
      );
    });
  });

  it("restores the last NSFW tab from the NSFW-specific storage key", async () => {
    nsfwEnabledValue = true;
    window.localStorage.setItem("library:tab:nsfw", "nsfw");

    const adultEntries = [
      ...entries,
      {
        seriesId: "local-adult-series",
        sourceSeriesId: "adult-series",
        source: "omegascans",
        title: "Secret Lesson",
        coverUrl: null,
        status: "reading",
        addedAt: "2026-01-05T00:00:00.000Z",
        updatedAt: "2026-01-05T00:00:00.000Z",
        currentPage: 0,
        progressUpdatedAt: "2026-01-05T00:00:00.000Z",
        currentChapterSourceId: "adult-ch-1",
        currentChapterTitle: "Chapter 1",
        totalChapters: 10,
        completedChapters: 1,
        unreadChapters: 9,
        downloadedChapters: 0,
        lastCompletedAt: null,
        lastCompletedChapterSourceId: null,
        lastCompletedChapterTitle: null,
        tagIds: [],
        adult: true,
      },
    ];

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/library?nsfw=1") {
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(adultEntries) });
      }
      if (url === "/api/tags") return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue([]) });
      if (url === "/api/library/refresh") return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({}) });
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<LibraryHome />);

    await screen.findByRole("tab", { name: /NSFW/i });
    expect(screen.getByRole("tab", { name: /NSFW/i })).toHaveAttribute("aria-selected", "true");

    const resumeLink = document.querySelector(
      `a[href="${buildReaderHref("local-adult-series", "adult-ch-1")}" ]`,
    );
    expect(resumeLink).not.toBeNull();
  });

  it("removes an item from continue reading without removing it from the library", async () => {
    const continueEntries = [
      {
        ...entries[0],
        currentPage: 4,
        progressUpdatedAt: "2026-01-06T00:00:00.000Z",
        currentChapterSourceId: "chapter-4",
        currentChapterTitle: "Chapter 4",
      },
      entries[1],
    ];

    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/library") {
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(continueEntries) });
      }
      if (url === "/api/tags") return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue([]) });
      if (url === "/api/library/refresh") return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({}) });
      if (url === "/api/reader/state?seriesId=local-series-a" && init?.method === "DELETE") {
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({ ok: true }) });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<LibraryHome />);

    await screen.findByText("Pick up where you left off");
    expect(screen.getByText("Chapter 4 · p.4")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove Alpha from continue reading" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/reader/state?seriesId=local-series-a", {
      method: "DELETE",
    });
    await waitFor(() => {
      expect(screen.queryByText("Chapter 4 · p.4")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});
