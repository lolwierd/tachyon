/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ManagePage from "./page";

let nsfwEnabledValue = false;
const setNsfwEnabledMock = vi.fn();

vi.mock("@/lib/nsfw-context", () => ({
  useNsfw: () => ({
    nsfwEnabled: nsfwEnabledValue,
    setNsfwEnabled: setNsfwEnabledMock,
  }),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("ManagePage", () => {
  beforeEach(() => {
    nsfwEnabledValue = false;
    setNsfwEnabledMock.mockReset();
    fetchMock.mockReset();
    window.localStorage.clear();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/tags") {
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue([]) });
      }
      if (url === "/api/anilist/status") {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            configured: false,
            connected: false,
            viewerName: null,
            expiresAt: null,
            lastSyncAt: null,
            linkedSeriesCount: 0,
            recentLogs: [],
          }),
        });
      }
      if (url === "/api/offline") {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            storage: {
              cacheBytes: 0,
              cachedFiles: 0,
              pinnedBytes: 0,
              pinnedChapters: 0,
            },
            chapters: [],
          }),
        });
      }
      if (url === "/api/memory/overview") {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            timeline: [],
            stats: {
              completedChaptersTotal: 0,
              completedChaptersLast30Days: 0,
              chaptersPerDayLast30Days: 0,
              activeDaysLast30Days: 0,
              currentStreakDays: 0,
              bestStreakDays: 0,
              monthlySummaries: [],
            },
          }),
        });
      }
      if (url === "/api/background/settings") {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            settings: {
              downloadConcurrency: 4,
              downloadConcurrencyFallback: 2,
              nextNAfterRead: 10,
              autoDeleteReadEnabled: false,
              autoDeleteKeepLastN: 5,
              defaultNewChapterLimit: 3,
              failureThreshold: 8,
              fallbackCooldownMinutes: 30,
              fallbackUntil: null,
            },
          }),
        });
      }
      if (url === "/api/network/path") {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            route: "tailscale",
            host: "tachyon.lolwierd.com",
            scheme: "https",
          }),
        });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  it("shows the current connection route", async () => {
    render(<ManagePage />);

    await waitFor(() => {
      expect(screen.getByText("Connection")).toBeInTheDocument();
    });

    expect(screen.getByText("Tailscale")).toBeInTheDocument();
    expect(screen.getByText("tachyon.lolwierd.com")).toBeInTheDocument();
    expect(screen.getByText("https")).toBeInTheDocument();
    expect(screen.getByText("Switch to tachyon-ts.lolwierd.com")).toBeInTheDocument();
    expect(screen.getByText("Prefer Tailscale host")).toBeInTheDocument();
  });
});
