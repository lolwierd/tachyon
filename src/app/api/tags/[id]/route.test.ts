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

const SAME_ORIGIN_HEADERS = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
};

function makePatchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/tags/tag-1", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...SAME_ORIGIN_HEADERS,
    },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest() {
  return new Request("http://localhost", {
    method: "DELETE",
    headers: SAME_ORIGIN_HEADERS,
  });
}

describe("tag detail API", () => {
  beforeEach(() => {
    deleteTagMock.mockReset();
    getTagMock.mockReset();
    updateTagMock.mockReset();
  });

  it("validates updates", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(makePatchRequest({ name: "Cozy" }), {
      params: Promise.resolve({ id: "tag-1" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });
  });

  it("updates a tag", async () => {
    updateTagMock.mockReturnValue({ id: "tag-1", name: "Cozy", type: "mood" });

    const { PATCH } = await import("./route");
    const response = await PATCH(makePatchRequest({ name: "Cozy", type: "mood" }), {
      params: Promise.resolve({ id: "tag-1" }),
    });

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
    const response = await DELETE(makeDeleteRequest(), {
      params: Promise.resolve({ id: "tag-1" }),
    });

    expect(deleteTagMock).toHaveBeenCalledWith("tag-1");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
