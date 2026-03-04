import { beforeEach, describe, expect, it, vi } from "vitest";

const getChapterListMock = vi.fn();

vi.mock("@/lib/sources/weebcentral", () => ({
  getChapterList: getChapterListMock,
}));

describe("GET /api/series/[id]/chapters", () => {
  beforeEach(() => {
    getChapterListMock.mockReset();
  });

  it("returns chapters with read state on refresh", async () => {
    getChapterListMock.mockResolvedValue([
      { sourceChapterId: "c1", chapterNo: 1, title: "Chapter 1" },
    ]);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/series/test-unique-3/chapters?refresh=true"),
      { params: Promise.resolve({ id: "test-unique-3" }) },
    );

    expect(getChapterListMock).toHaveBeenCalledWith("test-unique-3");
    const body = await response.json();
    expect(body).toEqual([
      {
        sourceChapterId: "c1",
        chapterNo: 1,
        title: "Chapter 1",
        readState: "unread",
        lastPage: 0,
      },
    ]);
  });

  it("returns a 500 payload on scraper failure when no cache exists", async () => {
    getChapterListMock.mockRejectedValue(new Error("chapters failed"));

    const { GET } = await import("./route");
    const response = await GET(
      new Request("http://localhost/api/series/test-unique-4/chapters?refresh=true"),
      { params: Promise.resolve({ id: "test-unique-4" }) },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "chapters failed" });
  });
});
