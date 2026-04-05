import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createTagMock = vi.fn();
const listTagsMock = vi.fn();

vi.mock("@/lib/library/tags", () => ({
  createTag: createTagMock,
  listTags: listTagsMock,
}));

const SAME_ORIGIN_HEADERS = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
};

function makePostRequest(body: unknown) {
  return new NextRequest("http://localhost/api/tags", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...SAME_ORIGIN_HEADERS,
    },
    body: JSON.stringify(body),
  });
}

describe("tags API", () => {
  beforeEach(() => {
    createTagMock.mockReset();
    listTagsMock.mockReset();
  });

  it("lists tags", async () => {
    listTagsMock.mockReturnValue([{ id: "tag-1", name: "Cozy" }]);

    const { GET } = await import("./route");
    const response = await GET();

    await expect(response.json()).resolves.toEqual([{ id: "tag-1", name: "Cozy" }]);
  });

  it("validates tag creation", async () => {
    const { POST } = await import("./route");
    const response = await POST(makePostRequest({ name: "Cozy" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request body",
      code: "invalid_body",
    });
  });

  it("creates tags", async () => {
    createTagMock.mockReturnValue({ id: "tag-1", name: "Cozy", type: "mood" });

    const { POST } = await import("./route");
    const response = await POST(makePostRequest({
      name: "Cozy",
      type: "mood",
      color: "#d97706",
    }));

    expect(createTagMock).toHaveBeenCalledWith({
      name: "Cozy",
      type: "mood",
      color: "#d97706",
    });
    await expect(response.json()).resolves.toEqual({ id: "tag-1", name: "Cozy", type: "mood" });
  });
});
