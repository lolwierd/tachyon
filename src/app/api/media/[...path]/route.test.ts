import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const originalCwd = process.cwd();
let tempDir = "";
let GET: typeof import("./route").GET;

describe("media proxy API", () => {
  beforeAll(async () => {
    vi.stubGlobal("fetch", fetchMock);
    tempDir = await mkdtemp(path.join(os.tmpdir(), "reader-media-test-"));
    process.chdir(tempDir);
    ({ GET } = await import("./route"));
  });

  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    vi.unstubAllGlobals();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects unknown media types", async () => {
    const response = await GET(new NextRequest("http://localhost/api/media/unknown"), {
      params: Promise.resolve({ path: ["unknown"] }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Unknown media type" });
  });

  it("validates chapter page query params", async () => {
    const missingUrl = await GET(new NextRequest("http://localhost/api/media/page"), {
      params: Promise.resolve({ path: ["page"] }),
    });
    expect(missingUrl.status).toBe(400);
    await expect(missingUrl.json()).resolves.toEqual({
      error: "Missing url query parameter",
    });

    const invalidUrl = await GET(new NextRequest("http://localhost/api/media/page?url=%%%"), {
      params: Promise.resolve({ path: ["page"] }),
    });
    expect(invalidUrl.status).toBe(400);
    await expect(invalidUrl.json()).resolves.toEqual({ error: "Invalid url" });

    const disallowedDomain = await GET(
      new NextRequest("http://localhost/api/media/page?url=https://evil.example.com/a.jpg"),
      {
        params: Promise.resolve({ path: ["page"] }),
      },
    );
    expect(disallowedDomain.status).toBe(400);
    await expect(disallowedDomain.json()).resolves.toEqual({ error: "Domain not allowed" });
  });

  it("streams cover images and forwards content type", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );

    const response = await GET(new NextRequest("http://localhost/api/media/cover/abc"), {
      params: Promise.resolve({ path: ["cover", "abc"] }),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://temp.compsci88.com/cover/fallback/abc.jpg",
      expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": expect.any(String),
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
  });

  it("returns upstream 404s for missing covers", async () => {
    fetchMock.mockResolvedValue(new Response("missing", { status: 404 }));

    const response = await GET(new NextRequest("http://localhost/api/media/cover/abc"), {
      params: Promise.resolve({ path: ["cover", "abc"] }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Cover not found" });
  });

  it("caches page images to disk and serves cache hits", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(new Uint8Array([9, 8, 7]), {
          status: 200,
          headers: { "content-type": "image/webp" },
        }),
      ),
    );

    const requestUrl =
      "http://localhost/api/media/page?url=https://hot.planeptune.us/chapter/page-1.webp";

    const miss = await GET(new NextRequest(requestUrl), {
      params: Promise.resolve({ path: ["page"] }),
    });

    expect(miss.status).toBe(200);
    expect(miss.headers.get("x-cache")).toBe("MISS");
    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.waitFor(() => {
      const cacheDir = path.join(tempDir, "data", "media-cache");
      expect(existsSync(cacheDir)).toBe(true);
      expect(readdirSync(cacheDir).length).toBeGreaterThan(0);
    });

    const hit = await GET(new NextRequest(requestUrl), {
      params: Promise.resolve({ path: ["page"] }),
    });

    expect(hit.status).toBe(200);
    expect(hit.headers.get("x-cache")).toBe("HIT");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
