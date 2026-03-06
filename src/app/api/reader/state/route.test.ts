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
      new NextRequest("http://localhost/api/reader/state?seriesId=s1&chapterId=c1"),
    );

    expect(getReaderStateMock).toHaveBeenCalledWith("s1", "c1");
    await expect(response.json()).resolves.toEqual({ progress: { currentPage: 4 } });
  });

  it("validates POST bodies", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/reader/state", {
        method: "POST",
        body: JSON.stringify({ seriesId: "s1" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "seriesId, chapterId, pageCount, and currentPage are required",
    });
  });

  it("saves reader progress from POST", async () => {
    saveReaderProgressMock.mockResolvedValue({ ok: true });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/reader/state", {
        method: "POST",
        body: JSON.stringify({
          seriesId: "s1",
          chapterId: "c1",
          chapterTitle: "Chapter 1",
          chapterNo: 1,
          pageCount: 10,
          currentPage: 2,
          completed: false,
        }),
      }),
    );

    expect(saveReaderProgressMock).toHaveBeenCalledWith({
      sourceSeriesId: "s1",
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
    const response = await PATCH(
      new NextRequest("http://localhost/api/reader/state", {
        method: "PATCH",
        body: JSON.stringify({
          seriesId: "s1",
          readingDirection: "diagonal",
          fitMode: "zoom",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "seriesId, readingDirection, and fitMode are required",
    });
  });

  it("updates preferences from PATCH", async () => {
    updateReaderPreferencesMock.mockResolvedValue({ readingDirection: "rtl", fitMode: "height" });

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest("http://localhost/api/reader/state", {
        method: "PATCH",
        body: JSON.stringify({
          seriesId: "s1",
          readingDirection: "rtl",
          fitMode: "height",
        }),
      }),
    );

    expect(updateReaderPreferencesMock).toHaveBeenCalledWith({
      sourceSeriesId: "s1",
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
    const response = await DELETE(new NextRequest("http://localhost/api/reader/state"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "seriesId is required",
    });
  });

  it("clears series reading progress from DELETE", async () => {
    clearSeriesReadingProgressMock.mockReturnValue(true);

    const { DELETE } = await import("./route");
    const response = await DELETE(
      new NextRequest("http://localhost/api/reader/state?seriesId=s1"),
    );

    expect(clearSeriesReadingProgressMock).toHaveBeenCalledWith("s1");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
