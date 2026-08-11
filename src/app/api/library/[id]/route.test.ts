import { beforeEach, describe, expect, it, vi } from "vitest";

const getLibraryEntryMock = vi.fn();
const removeLibraryEntryMock = vi.fn();
const setLibraryEntryAdultMock = vi.fn();
const deleteAllSeriesDownloadsMock = vi.fn();

vi.mock("@/lib/library/state", () => ({
  getLibraryEntry: getLibraryEntryMock,
  removeLibraryEntry: removeLibraryEntryMock,
  setLibraryEntryAdult: setLibraryEntryAdultMock,
}));

vi.mock("@/lib/offline/state", () => ({
  deleteAllSeriesDownloads: deleteAllSeriesDownloadsMock,
}));

const SAME_ORIGIN_HEADERS = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
};

function makeDeleteRequest(url = "http://localhost") {
  return new Request(url, {
    method: "DELETE",
    headers: SAME_ORIGIN_HEADERS,
  });
}

function makePatchRequest(url = "http://localhost", body: unknown) {
  return new Request(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...SAME_ORIGIN_HEADERS,
    },
    body: JSON.stringify(body),
  });
}

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

    expect(getLibraryEntryMock).toHaveBeenCalledWith("series-1", undefined);
    await expect(response.json()).resolves.toEqual({
      sourceSeriesId: "series-1",
      status: "reading",
    });
  });

  it("uses source query to disambiguate library entry", async () => {
    getLibraryEntryMock.mockReturnValue({ sourceSeriesId: "series-1", status: "reading" });

    const { GET } = await import("./route");
    await GET(new Request("http://localhost?source=oppai"), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(getLibraryEntryMock).toHaveBeenCalledWith("series-1", "oppai");
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
      code: "library_entry_not_found",
    });
  });
});

describe("DELETE /api/library/[id]", () => {
  beforeEach(() => {
    removeLibraryEntryMock.mockReset();
    deleteAllSeriesDownloadsMock.mockReset();
    deleteAllSeriesDownloadsMock.mockResolvedValue({ deleted: 0, removedFiles: 0, failures: [] });
  });

  it("removes a library entry and deletes its downloads", async () => {
    const { DELETE } = await import("./route");
    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(removeLibraryEntryMock).toHaveBeenCalledWith("series-1", undefined);
    expect(deleteAllSeriesDownloadsMock).toHaveBeenCalledWith("series-1", undefined);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("passes source query when removing", async () => {
    const { DELETE } = await import("./route");
    await DELETE(makeDeleteRequest("http://localhost?source=toonily"), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(deleteAllSeriesDownloadsMock).toHaveBeenCalledWith("series-1", "toonily");
    expect(removeLibraryEntryMock).toHaveBeenCalledWith("series-1", "toonily");
  });

  it("returns an internal error if download deletion fails", async () => {
    deleteAllSeriesDownloadsMock.mockRejectedValue(new Error("disk error"));

    const { DELETE } = await import("./route");
    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error",
      code: "internal_error",
    });
  });
});

describe("PATCH /api/library/[id]", () => {
  beforeEach(() => {
    setLibraryEntryAdultMock.mockReset();
  });

  it("requires NSFW mode to be enabled", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(makePatchRequest("http://localhost", { adult: true, nsfwEnabled: false }), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "NSFW mode must be enabled" });
  });

  it("updates the adult flag when NSFW mode is enabled", async () => {
    setLibraryEntryAdultMock.mockReturnValue({ sourceSeriesId: "series-1", adult: true });

    const { PATCH } = await import("./route");
    const response = await PATCH(makePatchRequest("http://localhost", { adult: true, nsfwEnabled: true }), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(setLibraryEntryAdultMock).toHaveBeenCalledWith("series-1", true, undefined);
    await expect(response.json()).resolves.toEqual({ sourceSeriesId: "series-1", adult: true });
  });

  it("passes source query when updating adult flag", async () => {
    setLibraryEntryAdultMock.mockReturnValue({ sourceSeriesId: "series-1", adult: true });

    const { PATCH } = await import("./route");
    await PATCH(makePatchRequest("http://localhost?source=oppai", { adult: true, nsfwEnabled: true }), {
      params: Promise.resolve({ id: "series-1" }),
    });

    expect(setLibraryEntryAdultMock).toHaveBeenCalledWith("series-1", true, "oppai");
  });
});
