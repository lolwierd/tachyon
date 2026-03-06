import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheRemotePage } from "./cache";

const {
    getFlareSolverrHeadersMock,
    sourceRequiresFlareSolverrMock,
    fetchMock,
} = vi.hoisted(() => ({
    getFlareSolverrHeadersMock: vi.fn(),
    sourceRequiresFlareSolverrMock: vi.fn(),
    fetchMock: vi.fn(),
}));

vi.mock("./flaresolverr", () => ({
    getFlareSolverrHeaders: getFlareSolverrHeadersMock,
}));

vi.mock("@/lib/sources/registry", () => ({
    sourceRequiresFlareSolverr: sourceRequiresFlareSolverrMock,
}));

let tempDir = "";
const originalCwd = process.cwd();

describe("media cache Cloudflare policy", () => {
    beforeAll(async () => {
        vi.stubGlobal("fetch", fetchMock);
        tempDir = await mkdtemp(path.join(os.tmpdir(), "reader-cache-test-"));
        process.chdir(tempDir);
    });

    beforeEach(() => {
        fetchMock.mockReset();
        getFlareSolverrHeadersMock.mockReset();
        sourceRequiresFlareSolverrMock.mockReset();
        sourceRequiresFlareSolverrMock.mockReturnValue(false);
        getFlareSolverrHeadersMock.mockResolvedValue(null);
    });

    afterAll(async () => {
        process.chdir(originalCwd);
        vi.unstubAllGlobals();
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it("does not invoke FlareSolverr for non-Cloudflare 403 responses", async () => {
        fetchMock.mockResolvedValue(
            new Response("forbidden", {
                status: 403,
                statusText: "Forbidden",
                headers: {
                    server: "nginx",
                    "content-type": "text/html",
                },
            }),
        );

        await expect(
            cacheRemotePage("https://cdn.example.com/page.jpg", undefined, {
                sourceName: "toonily",
                forceRefresh: true,
            }),
        ).rejects.toThrow("Upstream fetch failed (403)");

        expect(getFlareSolverrHeadersMock).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to FlareSolverr for Cloudflare challenge responses", async () => {
        fetchMock
            .mockResolvedValueOnce(
                new Response("<html>Attention Required! | Cloudflare</html>", {
                    status: 403,
                    statusText: "Forbidden",
                    headers: {
                        server: "cloudflare",
                        "cf-ray": "abc123",
                        "content-type": "text/html",
                    },
                }),
            )
            .mockResolvedValueOnce(
                new Response(new Uint8Array([1, 2, 3]), {
                    status: 200,
                    headers: {
                        "content-type": "image/jpeg",
                    },
                }),
            );

        getFlareSolverrHeadersMock.mockResolvedValue({
            Cookie: "cf_clearance=ok",
            "User-Agent": "SolverUA",
        });

        const result = await cacheRemotePage("https://cdn.example.com/page.jpg", undefined, {
            sourceName: "toonily",
            flareSolverrUrl: "https://toonily.me/",
            forceRefresh: true,
        });

        expect(result.contentType).toBe("image/jpeg");
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(getFlareSolverrHeadersMock).toHaveBeenCalledWith(
            "toonily",
            "https://toonily.me/",
            undefined,
        );

        const secondCall = fetchMock.mock.calls[1]?.[1] as { headers?: Record<string, string> };
        expect(secondCall?.headers?.Cookie).toBe("cf_clearance=ok");
        expect(secondCall?.headers?.["User-Agent"]).toBe("SolverUA");
    });

    it("always tries FlareSolverr first for required sources", async () => {
        sourceRequiresFlareSolverrMock.mockReturnValue(true);
        getFlareSolverrHeadersMock.mockResolvedValue({
            Cookie: "cf_required=1",
            "User-Agent": "SolverUA",
        });

        fetchMock.mockResolvedValue(
            new Response(new Uint8Array([9, 8, 7]), {
                status: 200,
                headers: {
                    "content-type": "image/png",
                },
            }),
        );

        const result = await cacheRemotePage("https://cdn.example.com/required.png", undefined, {
            sourceName: "madaradex",
            flareSolverrUrl: "https://madaradex.org/",
            forceRefresh: true,
        });

        expect(result.contentType).toBe("image/png");
        expect(getFlareSolverrHeadersMock).toHaveBeenCalledWith(
            "madaradex",
            "https://madaradex.org/",
            undefined,
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const firstCall = fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> };
        expect(firstCall?.headers?.Cookie).toBe("cf_required=1");
        expect(firstCall?.headers?.["User-Agent"]).toBe("SolverUA");
    });
});
