import { beforeEach, describe, expect, it, vi } from "vitest";

const getLibraryEntryMock = vi.fn();
const removeLibraryEntryMock = vi.fn();

vi.mock("@/lib/library/state", () => ({
  getLibraryEntry: getLibraryEntryMock,
  removeLibraryEntry: removeLibraryEntryMock,
}));

describe("GET /api/library/[id]", () => {
  beforeEach(() => {
    getLibraryEntryMock.mockReset();
    removeLibraryEntryMock.mockReset();
  });

  it("returns a library entry when present", async () => {
    getLibraryEntryMock.mockReturnValue({ sourceSeriesId: "series-1", status: "reading" });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(getLibraryEntryMock).toHaveBeenCalledWith("series-1");
    await expect(response.json()).resolves.toEqual({
      sourceSeriesId: "series-1",
      status: "reading",
    });
  });

  it("returns a 404 when the entry is missing", async () => {
    getLibraryEntryMock.mockReturnValue(null);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Library entry not found",
    });
  });
});

describe("DELETE /api/library/[id]", () => {
  beforeEach(() => {
    removeLibraryEntryMock.mockReset();
  });

  it("removes a library entry", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(removeLibraryEntryMock).toHaveBeenCalledWith("series-1");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
