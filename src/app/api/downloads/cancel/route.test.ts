import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cancelRunsByKindScopeMock = vi.fn();
const requestCancelRunMock = vi.fn();
const getSeriesMappingMock = vi.fn();

vi.mock("@/lib/background/queue", () => ({
  cancelRunsByKindScope: cancelRunsByKindScopeMock,
  requestCancelRun: requestCancelRunMock,
}));
vi.mock("@/lib/library/shared", () => ({
  getSeriesMapping: getSeriesMappingMock,
}));

const SAME_ORIGIN_HEADERS = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
};

function makePostRequest(body: unknown) {
  return new NextRequest("http://localhost/api/downloads/cancel", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...SAME_ORIGIN_HEADERS,
    },
    body: JSON.stringify(body),
  });
}

describe("downloads cancel API", () => {
  beforeEach(() => {
    cancelRunsByKindScopeMock.mockReset();
    requestCancelRunMock.mockReset();
    getSeriesMappingMock.mockReset();
    getSeriesMappingMock.mockReturnValue({
      seriesId: "local-series-1",
      sourceSeriesId: "series-1",
      source: "weebcentral",
    });
  });

  it("cancels all active download runs", async () => {
    cancelRunsByKindScopeMock.mockReturnValue({ requested: 2, runs: [] });

    const { POST } = await import("./route");
    const response = (await POST(makePostRequest({ scope: "all" })))!;

    expect(cancelRunsByKindScopeMock).toHaveBeenCalledWith({ kind: "download", all: true });
    await expect(response.json()).resolves.toEqual({ requested: 2, runs: [] });
  });

  it("validates series scope", async () => {
    const { POST } = await import("./route");
    const response = (await POST(makePostRequest({ scope: "series" })))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });
  });

  it("cancels by series scope", async () => {
    cancelRunsByKindScopeMock.mockReturnValue({ requested: 1, runs: [{ id: "run-1" }] });

    const { POST } = await import("./route");
    const response = (await POST(makePostRequest({
      scope: "series",
      seriesId: "local-series-1",
      source: "weebcentral",
    })))!;

    expect(cancelRunsByKindScopeMock).toHaveBeenCalledWith({
      kind: "download",
      sourceSeriesId: "series-1",
      sourceName: "weebcentral",
    });
    await expect(response.json()).resolves.toEqual({ requested: 1, runs: [{ id: "run-1" }] });
  });

  it("validates count scope", async () => {
    const { POST } = await import("./route");

    const nonPositive = (await POST(makePostRequest({ scope: "count", count: 0 })))!;

    expect(nonPositive.status).toBe(400);
    await expect(nonPositive.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });

    const wrongType = (await POST(makePostRequest({ scope: "count", count: "3" })))!;

    expect(wrongType.status).toBe(400);
    await expect(wrongType.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });
  });

  it("cancels recent count runs with truncation", async () => {
    cancelRunsByKindScopeMock.mockReturnValue({ requested: 3, runs: [] });

    const { POST } = await import("./route");
    const response = (await POST(makePostRequest({ scope: "count", count: 3.8 })))!;

    expect(cancelRunsByKindScopeMock).toHaveBeenCalledWith({
      kind: "download",
      count: 3,
    });
    await expect(response.json()).resolves.toEqual({ requested: 3, runs: [] });
  });

  it("validates run scope", async () => {
    const { POST } = await import("./route");
    const response = (await POST(makePostRequest({ scope: "run" })))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });
  });

  it("cancels a single run", async () => {
    requestCancelRunMock.mockReturnValue({ id: "run-123", status: "canceling" });

    const { POST } = await import("./route");
    const response = (await POST(makePostRequest({ scope: "run", runId: "run-123" })))!;

    expect(requestCancelRunMock).toHaveBeenCalledWith("run-123");
    await expect(response.json()).resolves.toEqual({
      requested: 1,
      runs: [{ id: "run-123", status: "canceling" }],
    });
  });

  it("validates unknown scope", async () => {
    const { POST } = await import("./route");
    const response = (await POST(makePostRequest({ scope: "foo" })))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });
  });
});
