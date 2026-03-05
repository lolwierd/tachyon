import { describe, expect, it, vi } from "vitest";

const enqueueUpdateForLibraryMock = vi.fn();

vi.mock("@/lib/background/enqueue", () => ({
  enqueueUpdateForLibrary: enqueueUpdateForLibraryMock,
}));

describe("POST /api/library/refresh", () => {
  it("enqueues a background library refresh run", async () => {
    enqueueUpdateForLibraryMock.mockReturnValue({
      id: "run-1",
      status: "queued",
      totalTasks: 3,
    });

    const { POST } = await import("./route");
    const response = await POST();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      runId: "run-1",
      run: {
        id: "run-1",
        status: "queued",
        totalTasks: 3,
      },
    });
    expect(enqueueUpdateForLibraryMock).toHaveBeenCalledWith("library_refresh", "manual");
  });
});
