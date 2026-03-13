/* @vitest-environment jsdom */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UpdatesPage from "./page";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
vi.stubGlobal("confirm", vi.fn(() => true));

describe("UpdatesPage", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/updates/rules") {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            rules: [
              {
                id: "rule-1",
                name: "Reading updates",
                enabled: true,
                targetType: "status_bucket",
                targetValue: { statuses: ["reading"] },
                intervalMinutes: 60,
                jitterSeconds: 30,
                nextRunAt: null,
                lastRunAt: null,
                lastRunId: null,
              },
            ],
          }),
        });
      }
      if (url === "/api/updates/runs?limit=30") {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            runs: [],
          }),
        });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
  });

  it("refreshes with no-store requests when the refresh button is clicked", async () => {
    const user = userEvent.setup();
    render(<UpdatesPage />);

    await screen.findByText("Reading updates");
    fetchMock.mockClear();

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/updates/rules",
        expect.objectContaining({ cache: "no-store" }),
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/updates/runs?limit=30",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
