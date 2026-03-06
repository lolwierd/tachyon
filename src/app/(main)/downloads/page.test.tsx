/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DownloadsPage from "./page";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
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

const settingsResponse = {
  settings: {
    downloadConcurrency: 3,
    downloadConcurrencyFallback: 1,
    fallbackUntil: null,
  },
  workerHeartbeat: null,
};

describe("DownloadsPage", () => {
  beforeEach(() => {
    nsfwEnabledValue = false;
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/downloads/runs?includeTasks=true&limit=50") {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            runs: [
              {
                id: "run-download",
                status: "running",
                trigger: "automation",
                totalTasks: 1,
                doneTasks: 0,
                failedTasks: 0,
                canceledTasks: 0,
                createdAt: "2026-03-06T00:00:00.000Z",
                updatedAt: "2026-03-06T00:00:00.000Z",
                scope: { sourceSeriesId: "safe-series", reason: "manual:chapters" },
                seriesTitle: "Safe Series",
                seriesLinkId: "safe-series",
                seriesAdult: false,
                tasks: [
                  {
                    id: "task-download",
                    taskType: "download_chapter",
                    sourceSeriesId: "safe-series",
                    sourceChapterId: "ch-1",
                    state: "running",
                    attempt: 1,
                    maxAttempts: 4,
                    lastError: null,
                    seriesTitle: "Safe Series",
                    seriesLinkId: "safe-series",
                    seriesAdult: false,
                    chapterNo: 1,
                    chapterTitle: "Chapter 1",
                  },
                ],
              },
              {
                id: "run-delete",
                status: "running",
                trigger: "manual",
                totalTasks: 1,
                doneTasks: 0,
                failedTasks: 0,
                canceledTasks: 0,
                createdAt: "2026-03-06T00:00:00.000Z",
                updatedAt: "2026-03-06T00:00:00.000Z",
                scope: { sourceSeriesId: "safe-series", reason: "manual:deleteRead" },
                seriesTitle: "Safe Series",
                seriesLinkId: "safe-series",
                seriesAdult: false,
                tasks: [
                  {
                    id: "task-delete",
                    taskType: "delete_read_downloads",
                    sourceSeriesId: "safe-series",
                    sourceChapterId: null,
                    state: "queued",
                    attempt: 1,
                    maxAttempts: 2,
                    lastError: null,
                    seriesTitle: "Safe Series",
                    seriesLinkId: "safe-series",
                    seriesAdult: false,
                    chapterNo: null,
                    chapterTitle: null,
                  },
                ],
              },
              {
                id: "run-adult",
                status: "running",
                trigger: "manual",
                totalTasks: 1,
                doneTasks: 0,
                failedTasks: 0,
                canceledTasks: 0,
                createdAt: "2026-03-06T00:00:00.000Z",
                updatedAt: "2026-03-06T00:00:00.000Z",
                scope: { sourceSeriesId: "adult-series", reason: "manual:chapters" },
                seriesTitle: "Secret Lesson",
                seriesLinkId: "adult-series",
                seriesAdult: true,
                tasks: [
                  {
                    id: "task-adult",
                    taskType: "download_chapter",
                    sourceSeriesId: "adult-series",
                    sourceChapterId: "adult-ch-1",
                    state: "running",
                    attempt: 1,
                    maxAttempts: 4,
                    lastError: null,
                    seriesTitle: "Secret Lesson",
                    seriesLinkId: "adult-series",
                    seriesAdult: true,
                    chapterNo: 1,
                    chapterTitle: "Chapter 1",
                  },
                ],
              },
            ],
          }),
        });
      }
      if (url === "/api/background/settings") {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue(settingsResponse),
        });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  it("hides NSFW runs when NSFW mode is off and shows run kinds", async () => {
    render(<DownloadsPage />);

    await screen.findByText("Download · manual:chapters");
    expect(screen.getAllByText("Safe Series")).toHaveLength(2);
    expect(screen.getByText("Download · manual:chapters")).toBeInTheDocument();
    expect(screen.getByText("Delete · manual:deleteRead")).toBeInTheDocument();
    expect(screen.queryByText("Secret Lesson")).not.toBeInTheDocument();
  });

  it("shows NSFW runs when NSFW mode is on", async () => {
    nsfwEnabledValue = true;

    render(<DownloadsPage />);

    await waitFor(() => {
      expect(screen.getByText("Secret Lesson")).toBeInTheDocument();
    });
  });
});
