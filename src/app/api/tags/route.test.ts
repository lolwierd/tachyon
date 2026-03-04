import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createTagMock = vi.fn();
const listTagsMock = vi.fn();

vi.mock("@/lib/library/tags", () => ({
  createTag: createTagMock,
  listTags: listTagsMock,
}));

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
    const response = await POST(
      new NextRequest("http://localhost/api/tags", {
        method: "POST",
        body: JSON.stringify({ name: "Cozy" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "name and type are required" });
  });

  it("creates tags", async () => {
    createTagMock.mockReturnValue({ id: "tag-1", name: "Cozy", type: "mood" });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/tags", {
        method: "POST",
        body: JSON.stringify({
          name: "Cozy",
          type: "mood",
          color: "#d97706",
        }),
      }),
    );

    expect(createTagMock).toHaveBeenCalledWith({
      name: "Cozy",
      type: "mood",
      color: "#d97706",
    });
    await expect(response.json()).resolves.toEqual({ id: "tag-1", name: "Cozy", type: "mood" });
  });
});
