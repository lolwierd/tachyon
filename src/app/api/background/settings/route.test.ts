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

const SAME_ORIGIN_HEADERS = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
};

function makePatchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/background/settings", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...SAME_ORIGIN_HEADERS,
    },
    body: JSON.stringify(body),
  });
}

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
    const response = await PATCH(makePatchRequest({ downloadConcurrency: 2 }));

    expect(updateBackgroundSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ downloadConcurrency: 2 }),
    );
    await expect(response.json()).resolves.toEqual({ settings: { downloadConcurrency: 2 } });
  });

  it("rejects invalid typed patch fields", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(makePatchRequest({
      downloadConcurrency: "4",
      nextNAfterRead: 3,
      autoDeleteReadEnabled: "true",
      fallbackUntil: null,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });
    expect(updateBackgroundSettingsMock).not.toHaveBeenCalled();
  });

  it("rejects bodies where every field is invalid", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(makePatchRequest({
      downloadConcurrency: "x",
      autoDeleteReadEnabled: "nope",
      fallbackUntil: 123,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });
    expect(updateBackgroundSettingsMock).not.toHaveBeenCalled();
  });
});
