import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getReaderStateMock = vi.fn();
const saveReaderProgressMock = vi.fn();
const updateReaderPreferencesMock = vi.fn();
const clearSeriesReadingProgressMock = vi.fn();

vi.mock("@/lib/reader/state", () => ({
  clearSeriesReadingProgress: clearSeriesReadingProgressMock,
  getReaderState: getReaderStateMock,
  saveReaderProgress: saveReaderProgressMock,
  updateReaderPreferences: updateReaderPreferencesMock,
}));

const SAME_ORIGIN_HEADERS = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
};

function makeJsonRequest(method: "POST" | "PATCH", body: unknown) {
  return new NextRequest("http://localhost/api/reader/state", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...SAME_ORIGIN_HEADERS,
    },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(url = "http://localhost/api/reader/state") {
  return new NextRequest(url, {
    method: "DELETE",
    headers: SAME_ORIGIN_HEADERS,
  });
}

describe("reader state API", () => {
  beforeEach(() => {
    getReaderStateMock.mockReset();
    saveReaderProgressMock.mockReset();
    updateReaderPreferencesMock.mockReset();
    clearSeriesReadingProgressMock.mockReset();
  });

  it("validates required GET params", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/reader/state"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "seriesId and chapterId are required",
    });
  });

  it("returns the current reader state for GET", async () => {
    getReaderStateMock.mockReturnValue({ progress: { currentPage: 4 } });

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest("http://localhost/api/reader/state?seriesId=s1&chapterId=c1&source=oppai"),
    );

    expect(getReaderStateMock).toHaveBeenCalledWith("s1", "c1", "oppai");
    await expect(response.json()).resolves.toEqual({ progress: { currentPage: 4 } });
  });

  it("validates POST bodies", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeJsonRequest("POST", { seriesId: "s1" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });
  });

  it("saves reader progress from POST", async () => {
    saveReaderProgressMock.mockResolvedValue({ ok: true });

    const { POST } = await import("./route");
    const response = await POST(makeJsonRequest("POST", {
      seriesId: "s1",
      source: "oppai",
      chapterId: "c1",
      chapterTitle: "Chapter 1",
      chapterNo: 1,
      pageCount: 10,
      currentPage: 2,
      completed: false,
    }));

    expect(saveReaderProgressMock).toHaveBeenCalledWith({
      sourceSeriesId: "s1",
      sourceName: "oppai",
      sourceChapterId: "c1",
      chapterTitle: "Chapter 1",
      chapterNo: 1,
      pageCount: 10,
      currentPage: 2,
      completed: false,
    });
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("validates PATCH enum inputs", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(makeJsonRequest("PATCH", {
      seriesId: "s1",
      readingDirection: "diagonal",
      fitMode: "zoom",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });
  });

  it("updates preferences from PATCH", async () => {
    updateReaderPreferencesMock.mockResolvedValue({ readingDirection: "rtl", fitMode: "height" });

    const { PATCH } = await import("./route");
    const response = await PATCH(makeJsonRequest("PATCH", {
      seriesId: "s1",
      source: "oppai",
      readingDirection: "rtl",
      fitMode: "height",
    }));

    expect(updateReaderPreferencesMock).toHaveBeenCalledWith({
      sourceSeriesId: "s1",
      sourceName: "oppai",
      readingDirection: "rtl",
      fitMode: "height",
    });
    await expect(response.json()).resolves.toEqual({
      readingDirection: "rtl",
      fitMode: "height",
    });
  });

  it("validates DELETE query params", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(makeDeleteRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "seriesId is required",
    });
  });

  it("clears series reading progress from DELETE", async () => {
    clearSeriesReadingProgressMock.mockReturnValue(true);

    const { DELETE } = await import("./route");
    const response = await DELETE(makeDeleteRequest("http://localhost/api/reader/state?seriesId=s1&source=oppai"));

    expect(clearSeriesReadingProgressMock).toHaveBeenCalledWith("s1", "oppai");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
