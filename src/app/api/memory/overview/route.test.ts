import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMemoryOverviewMock = vi.fn();

vi.mock("@/lib/memory/state", () => ({
    getMemoryOverview: getMemoryOverviewMock,
}));

describe("memory overview API", () => {
    beforeEach(() => {
        getMemoryOverviewMock.mockReset();
    });

    it("returns memory overview with default limit", async () => {
        getMemoryOverviewMock.mockReturnValue({ timeline: [], stats: { completedChaptersTotal: 0 } });

        const { GET } = await import("./route");
        const response = await GET(new NextRequest("http://localhost/api/memory/overview"));

        expect(getMemoryOverviewMock).toHaveBeenCalledWith(40, { includeNsfw: false });
        await expect(response.json()).resolves.toEqual({
            timeline: [],
            stats: { completedChaptersTotal: 0 },
        });
    });

    it("accepts custom limit query", async () => {
        getMemoryOverviewMock.mockReturnValue({ timeline: [], stats: { completedChaptersTotal: 0 } });

        const { GET } = await import("./route");
        await GET(new NextRequest("http://localhost/api/memory/overview?limit=12&nsfw=1"));

        expect(getMemoryOverviewMock).toHaveBeenCalledWith(12, { includeNsfw: true });
    });

    it("returns 500 payload on failure", async () => {
        getMemoryOverviewMock.mockImplementation(() => {
            throw new Error("boom");
        });

        const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/memory/overview"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error",
      code: "internal_error",
    });
  });
});
