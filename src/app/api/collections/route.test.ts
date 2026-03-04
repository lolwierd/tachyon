import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createCollectionMock = vi.fn();
const listCollectionsMock = vi.fn();

vi.mock("@/lib/library/collections", () => ({
  createCollection: createCollectionMock,
  listCollections: listCollectionsMock,
}));

describe("collections API", () => {
  beforeEach(() => {
    createCollectionMock.mockReset();
    listCollectionsMock.mockReset();
  });

  it("lists collections", async () => {
    listCollectionsMock.mockReturnValue([{ id: "col-1", name: "Favorites" }]);

    const { GET } = await import("./route");
    const response = await GET();

    await expect(response.json()).resolves.toEqual([{ id: "col-1", name: "Favorites" }]);
  });

  it("validates collection creation", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/collections", {
        method: "POST",
        body: JSON.stringify({ description: "No name" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "name is required" });
  });

  it("creates collections", async () => {
    createCollectionMock.mockReturnValue({ id: "col-1", name: "Favorites" });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/collections", {
        method: "POST",
        body: JSON.stringify({
          name: "Favorites",
          description: "Best ongoing titles",
          icon: "Star",
        }),
      }),
    );

    expect(createCollectionMock).toHaveBeenCalledWith({
      name: "Favorites",
      description: "Best ongoing titles",
      icon: "Star",
    });
    await expect(response.json()).resolves.toEqual({ id: "col-1", name: "Favorites" });
  });
});
