import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSeriesPolicyMock = vi.fn();
const upsertSeriesPolicyMock = vi.fn();
const getBackgroundSettingsMock = vi.fn();

vi.mock("@/lib/background/enqueue", () => ({
  getSeriesPolicy: getSeriesPolicyMock,
  upsertSeriesPolicy: upsertSeriesPolicyMock,
}));

vi.mock("@/lib/background/settings", () => ({
  getBackgroundSettings: getBackgroundSettingsMock,
}));

describe("downloads policy API", () => {
  beforeEach(() => {
    getSeriesPolicyMock.mockReset();
    upsertSeriesPolicyMock.mockReset();
    getBackgroundSettingsMock.mockReset();
    getBackgroundSettingsMock.mockReturnValue({ defaultNewChapterLimit: 3 });
  });

  it("returns existing per-series policy", async () => {
    getSeriesPolicyMock.mockReturnValue({
      sourceSeriesId: "series-1",
      autoDownloadNewEnabled: true,
      autoDownloadNewLimit: 9,
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/downloads/policy/series-1"), {
      params: Promise.resolve({ seriesId: "series-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sourceSeriesId: "series-1",
      autoDownloadNewEnabled: true,
      autoDownloadNewLimit: 9,
    });
  });

  it("falls back to defaults when policy does not exist", async () => {
    getSeriesPolicyMock.mockReturnValue(null);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/downloads/policy/series-1"), {
      params: Promise.resolve({ seriesId: "series-1" }),
    });

    await expect(response.json()).resolves.toEqual({
      sourceSeriesId: "series-1",
      autoDownloadNewEnabled: false,
      autoDownloadNewLimit: 3,
    });
  });

  it("validates required fields on update", async () => {
    const { PUT } = await import("./route");

    const missingEnabled = await PUT(
      new NextRequest("http://localhost/api/downloads/policy/series-1", {
        method: "PUT",
        body: JSON.stringify({ autoDownloadNewLimit: 5 }),
      }),
      { params: Promise.resolve({ seriesId: "series-1" }) },
    );

    expect(missingEnabled.status).toBe(400);
    await expect(missingEnabled.json()).resolves.toEqual({
      error: "autoDownloadNewEnabled is required",
    });

    const missingLimit = await PUT(
      new NextRequest("http://localhost/api/downloads/policy/series-1", {
        method: "PUT",
        body: JSON.stringify({ autoDownloadNewEnabled: true }),
      }),
      { params: Promise.resolve({ seriesId: "series-1" }) },
    );

    expect(missingLimit.status).toBe(400);
    await expect(missingLimit.json()).resolves.toEqual({
      error: "autoDownloadNewLimit is required",
    });
  });

  it("returns not found when series mapping is missing", async () => {
    upsertSeriesPolicyMock.mockReturnValue(null);

    const { PUT } = await import("./route");
    const response = await PUT(
      new NextRequest("http://localhost/api/downloads/policy/series-1", {
        method: "PUT",
        body: JSON.stringify({
          autoDownloadNewEnabled: true,
          autoDownloadNewLimit: 5,
        }),
      }),
      { params: Promise.resolve({ seriesId: "series-1" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Series mapping not found" });
  });

  it("updates policy", async () => {
    upsertSeriesPolicyMock.mockReturnValue({
      sourceSeriesId: "series-1",
      autoDownloadNewEnabled: true,
      autoDownloadNewLimit: 4,
    });

    const { PUT } = await import("./route");
    const response = await PUT(
      new NextRequest("http://localhost/api/downloads/policy/series-1", {
        method: "PUT",
        body: JSON.stringify({
          autoDownloadNewEnabled: true,
          autoDownloadNewLimit: 4,
        }),
      }),
      { params: Promise.resolve({ seriesId: "series-1" }) },
    );

    expect(upsertSeriesPolicyMock).toHaveBeenCalledWith({
      sourceSeriesId: "series-1",
      autoDownloadNewEnabled: true,
      autoDownloadNewLimit: 4,
    });
    await expect(response.json()).resolves.toEqual({
      sourceSeriesId: "series-1",
      autoDownloadNewEnabled: true,
      autoDownloadNewLimit: 4,
    });
  });
});
