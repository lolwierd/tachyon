import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteTagMock = vi.fn();
const getTagMock = vi.fn();
const updateTagMock = vi.fn();

vi.mock("@/lib/library/tags", () => ({
  deleteTag: deleteTagMock,
  getTag: getTagMock,
  updateTag: updateTagMock,
}));

describe("tag detail API", () => {
  beforeEach(() => {
    deleteTagMock.mockReset();
    getTagMock.mockReset();
    updateTagMock.mockReset();
  });

  it("validates updates", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest("http://localhost/api/tags/tag-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Cozy" }),
      }),
      { params: Promise.resolve({ id: "tag-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "name and type are required" });
  });

  it("updates a tag", async () => {
    updateTagMock.mockReturnValue({ id: "tag-1", name: "Cozy", type: "mood" });

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest("http://localhost/api/tags/tag-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Cozy", type: "mood" }),
      }),
      { params: Promise.resolve({ id: "tag-1" }) },
    );

    expect(updateTagMock).toHaveBeenCalledWith("tag-1", {
      name: "Cozy",
      type: "mood",
      color: undefined,
    });
    await expect(response.json()).resolves.toEqual({ id: "tag-1", name: "Cozy", type: "mood" });
  });

  it("deletes a tag", async () => {
    getTagMock.mockReturnValue({ id: "tag-1", name: "Cozy", type: "mood" });

    const { DELETE } = await import("./route");
    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ id: "tag-1" }),
    });

    expect(deleteTagMock).toHaveBeenCalledWith("tag-1");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
