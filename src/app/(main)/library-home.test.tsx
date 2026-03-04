/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryHome } from "./library-home";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
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

const entries = [
  {
    sourceSeriesId: "series-a",
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
    collectionIds: [],
    tagIds: [],
  },
  {
    sourceSeriesId: "series-b",
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
    collectionIds: [],
    tagIds: [],
  },
];

describe("LibraryHome", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/library") return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(entries) });
      if (url === "/api/collections") return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue([]) });
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
      expect(links[0]?.getAttribute("href")).toBe("/series/series-b");
    });

    await user.selectOptions(sortSelect, "downloaded-asc");
    await waitFor(() => {
      const links = Array.from(
        document.querySelectorAll('a[href^="/series/"]'),
      ) as HTMLAnchorElement[];
      expect(links[0]?.getAttribute("href")).toBe("/series/series-a");
    });
  });
});
