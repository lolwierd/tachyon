import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteCollectionMock = vi.fn();
const getCollectionMock = vi.fn();
const updateCollectionMock = vi.fn();

vi.mock("@/lib/library/collections", () => ({
  deleteCollection: deleteCollectionMock,
  getCollection: getCollectionMock,
  updateCollection: updateCollectionMock,
}));

describe("collection detail API", () => {
  beforeEach(() => {
    deleteCollectionMock.mockReset();
    getCollectionMock.mockReset();
    updateCollectionMock.mockReset();
  });

  it("validates updates", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest("http://localhost/api/collections/col-1", {
        method: "PATCH",
        body: JSON.stringify({ description: "No name" }),
      }),
      { params: Promise.resolve({ id: "col-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "name is required" });
  });

  it("updates a collection", async () => {
    updateCollectionMock.mockReturnValue({ id: "col-1", name: "Favorites" });

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest("http://localhost/api/collections/col-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Favorites" }),
      }),
      { params: Promise.resolve({ id: "col-1" }) },
    );

    expect(updateCollectionMock).toHaveBeenCalledWith("col-1", {
      name: "Favorites",
      description: undefined,
      icon: undefined,
    });
    await expect(response.json()).resolves.toEqual({ id: "col-1", name: "Favorites" });
  });

  it("deletes a collection", async () => {
    getCollectionMock.mockReturnValue({ id: "col-1", name: "Favorites" });

    const { DELETE } = await import("./route");
    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: "col-1" }),
    });

    expect(deleteCollectionMock).toHaveBeenCalledWith("col-1");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
