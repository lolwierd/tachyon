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

const SAME_ORIGIN_HEADERS = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
};

function makePutRequest(body: unknown) {
  return new NextRequest("http://localhost/api/downloads/policy/series-1", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...SAME_ORIGIN_HEADERS,
    },
    body: JSON.stringify(body),
  });
}

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
      makePutRequest({ autoDownloadNewLimit: 5 }),
      { params: Promise.resolve({ seriesId: "series-1" }) },
    );

    expect(missingEnabled.status).toBe(400);
    await expect(missingEnabled.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });

    const missingLimit = await PUT(
      makePutRequest({ autoDownloadNewEnabled: true }),
      { params: Promise.resolve({ seriesId: "series-1" }) },
    );

    expect(missingLimit.status).toBe(400);
    await expect(missingLimit.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });
  });

  it("returns not found when series mapping is missing", async () => {
    upsertSeriesPolicyMock.mockReturnValue(null);

    const { PUT } = await import("./route");
    const response = await PUT(
      makePutRequest({
        autoDownloadNewEnabled: true,
        autoDownloadNewLimit: 5,
      }),
      { params: Promise.resolve({ seriesId: "series-1" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Series mapping not found" });
  });

  it("updates policy", async () => {
    upsertSeriesPolicyMock.mockReturnValue({
      sourceSeriesId: "series-1",
      autoDownloadNewEnabled: true,
      autoDownloadNewLimit: 4,
    });

    const { PUT } = await import("./route");
    const response = await PUT(
      makePutRequest({
        autoDownloadNewEnabled: true,
        autoDownloadNewLimit: 4,
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
