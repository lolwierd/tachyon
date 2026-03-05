import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBackgroundSettingsMock = vi.fn();
const getDefaultBackgroundSettingsMock = vi.fn();
const updateBackgroundSettingsMock = vi.fn();
const getLatestWorkerHeartbeatMock = vi.fn();
const getWorkerRuntimeStateMock = vi.fn();

vi.mock("@/lib/background/settings", () => ({
  getBackgroundSettings: getBackgroundSettingsMock,
  getDefaultBackgroundSettings: getDefaultBackgroundSettingsMock,
  updateBackgroundSettings: updateBackgroundSettingsMock,
}));

vi.mock("@/lib/background/queue", () => ({
  getLatestWorkerHeartbeat: getLatestWorkerHeartbeatMock,
}));

vi.mock("@/lib/background/worker", () => ({
  getWorkerRuntimeState: getWorkerRuntimeStateMock,
}));

describe("background settings API", () => {
  beforeEach(() => {
    getBackgroundSettingsMock.mockReset();
    getDefaultBackgroundSettingsMock.mockReset();
    updateBackgroundSettingsMock.mockReset();
    getLatestWorkerHeartbeatMock.mockReset();
    getWorkerRuntimeStateMock.mockReset();
  });

  it("returns settings and worker state", async () => {
    getBackgroundSettingsMock.mockReturnValue({ downloadConcurrency: 4 });
    getDefaultBackgroundSettingsMock.mockReturnValue({ downloadConcurrency: 4 });
    getLatestWorkerHeartbeatMock.mockReturnValue({ workerId: "w1" });
    getWorkerRuntimeStateMock.mockReturnValue({ started: true });

    const { GET } = await import("./route");
    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      settings: { downloadConcurrency: 4 },
      defaults: { downloadConcurrency: 4 },
      workerHeartbeat: { workerId: "w1" },
      runtime: { started: true },
    });
  });

  it("updates settings", async () => {
    updateBackgroundSettingsMock.mockReturnValue({ downloadConcurrency: 2 });

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest("http://localhost/api/background/settings", {
        method: "PATCH",
        body: JSON.stringify({ downloadConcurrency: 2 }),
      }),
    );

    expect(updateBackgroundSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ downloadConcurrency: 2 }),
    );
    await expect(response.json()).resolves.toEqual({ settings: { downloadConcurrency: 2 } });
  });

  it("drops invalid typed patch fields", async () => {
    updateBackgroundSettingsMock.mockReturnValue({ nextNAfterRead: 3 });

    const { PATCH } = await import("./route");
    await PATCH(
      new NextRequest("http://localhost/api/background/settings", {
        method: "PATCH",
        body: JSON.stringify({
          downloadConcurrency: "4",
          nextNAfterRead: 3,
          autoDeleteReadEnabled: "true",
          fallbackUntil: null,
        }),
      }),
    );

    expect(updateBackgroundSettingsMock).toHaveBeenCalledWith({
      downloadConcurrency: undefined,
      downloadConcurrencyFallback: undefined,
      nextNAfterRead: 3,
      autoDeleteReadEnabled: undefined,
      autoDeleteKeepLastN: undefined,
      defaultNewChapterLimit: undefined,
      failureThreshold: undefined,
      fallbackCooldownMinutes: undefined,
      fallbackUntil: null,
    });
  });
});
