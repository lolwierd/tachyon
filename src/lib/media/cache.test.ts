import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_DIR, cacheRemotePage, ensureMediaCacheDir, getCachePath, optimizeAllCachedImages } from "./cache";

const {
    getFlareSolverrHeadersMock,
    resolverCancelMock,
    resolverResolve4Mock,
    resolverResolve6Mock,
    sourceRequiresFlareSolverrMock,
    fetchMock,
} = vi.hoisted(() => ({
    getFlareSolverrHeadersMock: vi.fn(),
    resolverCancelMock: vi.fn(),
    resolverResolve4Mock: vi.fn(),
    resolverResolve6Mock: vi.fn(),
    sourceRequiresFlareSolverrMock: vi.fn(),
    fetchMock: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
    Resolver: class {
        cancel = resolverCancelMock;
        resolve4 = resolverResolve4Mock;
        resolve6 = resolverResolve6Mock;
    },
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

    beforeEach(async () => {
        fetchMock.mockReset();
        resolverCancelMock.mockReset();
        resolverResolve4Mock.mockReset();
        resolverResolve6Mock.mockReset();
        resolverResolve4Mock.mockResolvedValue(["203.0.113.10"]);
        resolverResolve6Mock.mockResolvedValue([]);
        getFlareSolverrHeadersMock.mockReset();
        sourceRequiresFlareSolverrMock.mockReset();
        sourceRequiresFlareSolverrMock.mockReturnValue(false);
        getFlareSolverrHeadersMock.mockResolvedValue(null);
        await rm(CACHE_DIR, { recursive: true, force: true });
    });

    afterAll(async () => {
        process.chdir(originalCwd);
        vi.unstubAllGlobals();
        await rm(CACHE_DIR, { recursive: true, force: true });
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

    it("returns the raw cache path on cache hits even when serving an optimized file", async () => {
        const url = "https://cdn.example.com/optimized.jpg";
        const cachePath = getCachePath(url);
        const hash = createHash("sha256").update(url).digest("base64url");
        const optPath = path.join(CACHE_DIR, `${hash}.opt.webp`);

        ensureMediaCacheDir();
        await writeFile(cachePath, Buffer.from("raw"));
        await writeFile(optPath, Buffer.from("optimized"));

        const result = await cacheRemotePage(url);

        expect(result.fromCache).toBe(true);
        expect(result.cachePath).toBe(cachePath);
        expect(result.contentType).toBe("image/webp");
        expect(result.data).toEqual(Buffer.from("optimized"));
    });

    it("dedupes concurrent cold-cache page requests for the same url", async () => {
        const url = "https://cdn.example.com/concurrent.jpg";
        let resolveFetch: ((value: Response | PromiseLike<Response>) => void) | null = null;

        fetchMock.mockImplementation(() => new Promise<Response>((resolve) => {
            resolveFetch = resolve;
        }));

        const first = cacheRemotePage(url);
        const second = cacheRemotePage(url);

        await vi.waitFor(() => {
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        resolveFetch!(new Response(new Uint8Array([4, 5, 6]), {
            status: 200,
            headers: {
                "content-type": "image/jpeg",
            },
        }));

        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(firstResult.fromCache).toBe(false);
        expect(secondResult.fromCache).toBe(false);
        expect(firstResult.data).toEqual(Buffer.from([4, 5, 6]));
        expect(secondResult.data).toEqual(Buffer.from([4, 5, 6]));
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const hit = await cacheRemotePage(url);
        expect(hit.fromCache).toBe(true);
    });

    it("keeps original cached files when generating optimized variants", async () => {
        const url = "https://cdn.example.com/big.jpg";
        const cachePath = getCachePath(url);
        const hash = createHash("sha256").update(url).digest("base64url");
        const optPath = path.join(CACHE_DIR, `${hash}.opt.webp`);
        const width = 700;
        const height = 700;
        const pixels = randomBytes(width * height * 3);

        await mkdir(path.dirname(cachePath), { recursive: true });
        const rawImage = await sharp(pixels, {
            raw: {
                width,
                height,
                channels: 3,
            },
        }).jpeg({ quality: 95 }).toBuffer();

        expect(rawImage.byteLength).toBeGreaterThan(200_000);
        await writeFile(cachePath, rawImage);

        const result = await optimizeAllCachedImages();

        expect(result.optimized).toBe(1);
        expect(result.removedBytes).toBe(0);
        expect(existsSync(cachePath)).toBe(true);
        expect(existsSync(optPath)).toBe(true);
        await expect(readFile(cachePath)).resolves.toEqual(rawImage);
    }, 15_000);

    it("returns the raw image immediately and optimizes large cold-cache responses in the background", async () => {
        const url = "https://cdn.example.com/first-hit-large.jpg";
        const cachePath = getCachePath(url);
        const hash = createHash("sha256").update(url).digest("base64url");
        const optPath = path.join(CACHE_DIR, `${hash}.opt.webp`);
        const width = 700;
        const height = 700;
        const pixels = randomBytes(width * height * 3);
        const rawImage = await sharp(pixels, {
            raw: {
                width,
                height,
                channels: 3,
            },
        }).jpeg({ quality: 95 }).toBuffer();

        expect(rawImage.byteLength).toBeGreaterThan(200_000);

        fetchMock.mockResolvedValue(
            new Response(new Uint8Array(rawImage), {
                status: 200,
                headers: {
                    "content-type": "image/jpeg",
                },
            }),
        );

        const result = await cacheRemotePage(url, undefined, { forceRefresh: true });

        expect(result.fromCache).toBe(false);
        expect(result.contentType).toBe("image/jpeg");
        expect(result.data).toEqual(rawImage);
        await expect(readFile(cachePath)).resolves.toEqual(rawImage);

        await vi.waitFor(async () => {
            expect(existsSync(optPath)).toBe(true);
            const optimized = await readFile(optPath);
            expect(optimized.byteLength).toBeGreaterThan(0);
        });
    }, 15_000);

    it("rejects oversized upstream responses before buffering them", async () => {
        fetchMock.mockResolvedValue(
            new Response(new Uint8Array([1, 2, 3]), {
                status: 200,
                headers: {
                    "content-type": "image/jpeg",
                    "content-length": String(60 * 1024 * 1024),
                },
            }),
        );

        await expect(
            cacheRemotePage("https://cdn.example.com/too-large.jpg", undefined, { forceRefresh: true }),
        ).rejects.toThrow("Upstream response too large");
    });

    it("falls back to a safe image content type when the upstream content type is unsafe", async () => {
        fetchMock.mockResolvedValue(
            new Response(new Uint8Array([1, 2, 3]), {
                status: 200,
                headers: {
                    "content-type": "text/html; charset=utf-8",
                },
            }),
        );

        const result = await cacheRemotePage("https://cdn.example.com/mislabeled.jpg", undefined, {
            forceRefresh: true,
        });

        expect(result.contentType).toBe("image/jpeg");
    });
});
