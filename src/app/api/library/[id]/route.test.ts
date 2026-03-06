import { beforeEach, describe, expect, it, vi } from "vitest";

const getLibraryEntryMock = vi.fn();
const removeLibraryEntryMock = vi.fn();
const setLibraryEntryAdultMock = vi.fn();

vi.mock("@/lib/library/state", () => ({
  getLibraryEntry: getLibraryEntryMock,
  removeLibraryEntry: removeLibraryEntryMock,
  setLibraryEntryAdult: setLibraryEntryAdultMock,
}));

describe("GET /api/library/[id]", () => {
  beforeEach(() => {
    getLibraryEntryMock.mockReset();
    removeLibraryEntryMock.mockReset();
    setLibraryEntryAdultMock.mockReset();
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

describe("PATCH /api/library/[id]", () => {
  beforeEach(() => {
    setLibraryEntryAdultMock.mockReset();
  });

  it("requires NSFW mode to be enabled", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(new Request("http://localhost", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adult: true, nsfwEnabled: false }),
    }), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "NSFW mode must be enabled" });
  });

  it("updates the adult flag when NSFW mode is enabled", async () => {
    setLibraryEntryAdultMock.mockReturnValue({ sourceSeriesId: "series-1", adult: true });

    const { PATCH } = await import("./route");
    const response = await PATCH(new Request("http://localhost", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adult: true, nsfwEnabled: true }),
    }), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(setLibraryEntryAdultMock).toHaveBeenCalledWith("series-1", true);
    await expect(response.json()).resolves.toEqual({ sourceSeriesId: "series-1", adult: true });
  });
});
