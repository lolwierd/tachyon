import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { series, sourceMapping } from "@/lib/db/schema";
import { registerSource } from "@/lib/sources/registry";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchMock,
  resolverCancelMock,
  resolverResolve4Mock,
  resolverResolve6Mock,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  resolverCancelMock: vi.fn(),
  resolverResolve4Mock: vi.fn(),
  resolverResolve6Mock: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    cancel = resolverCancelMock;
    resolve4 = resolverResolve4Mock;
    resolve6 = resolverResolve6Mock;
  },
}));

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
    resolverCancelMock.mockReset();
    resolverResolve4Mock.mockReset();
    resolverResolve6Mock.mockReset();
    resolverResolve4Mock.mockResolvedValue(["203.0.113.11"]);
    resolverResolve6Mock.mockResolvedValue([]);
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
      new NextRequest("http://localhost/api/media/page?url=http://127.0.0.1/a.jpg"),
      {
        params: Promise.resolve({ path: ["page"] }),
      },
    );
    expect(disallowedDomain.status).toBe(400);
    await expect(disallowedDomain.json()).resolves.toEqual({ error: "URL not allowed" });
  });

  it("caches cover images and serves cache hits", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })),
    );

    const response = await GET(new NextRequest("http://localhost/api/media/cover/abc"), {
      params: Promise.resolve({ path: ["cover", "abc"] }),
    });

    const [coverUrl, coverOptions] = fetchMock.mock.calls[0] ?? [];
    expect(String(coverUrl)).toBe("https://temp.compsci88.com/cover/fallback/abc.jpg");
    expect(coverOptions).toMatchObject({
      headers: expect.objectContaining({
        "User-Agent": expect.any(String),
      }),
      redirect: "manual",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-cache")).toBe("MISS");

    const cachedResponse = await GET(new NextRequest("http://localhost/api/media/cover/abc"), {
      params: Promise.resolve({ path: ["cover", "abc"] }),
    });
    expect(cachedResponse.headers.get("x-cache")).toBe("HIT");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches cover when refresh=true is passed", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })),
    );

    await GET(new NextRequest("http://localhost/api/media/cover/refresh-me"), {
      params: Promise.resolve({ path: ["cover", "refresh-me"] }),
    });
    const refreshed = await GET(
      new NextRequest("http://localhost/api/media/cover/refresh-me?refresh=true"),
      {
        params: Promise.resolve({ path: ["cover", "refresh-me"] }),
      },
    );

    expect(refreshed.headers.get("x-cache")).toBe("MISS");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns upstream 404s for missing covers", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("missing", { status: 404 })));

    const response = await GET(new NextRequest("http://localhost/api/media/cover/missing-404"), {
      params: Promise.resolve({ path: ["cover", "missing-404"] }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Cover not found" });
  });

  it("falls back to AniList when a stored cover upstream is dead", async () => {
    getDb().insert(series).values({
      id: "dead-cover-with-anilist",
      title: "Fallback Test",
      coverUrl: "https://dead.example/cover.jpg",
      anilistId: 30013,
    }).run();

    fetchMock
      .mockResolvedValueOnce(new Response("upstream unavailable", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          Media: {
            coverImage: {
              extraLarge: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/test.jpg",
            },
          },
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }));

    const response = await GET(
      new NextRequest("http://localhost/api/media/cover/dead-cover-with-anilist"),
      { params: Promise.resolve({ path: ["cover", "dead-cover-with-anilist"] }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-cache")).toBe("MISS");
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://dead.example/cover.jpg",
      "https://graphql.anilist.co",
      "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/test.jpg",
    ]);
  });

  it("skips the known-dead WeebCentral cover host", async () => {
    getDb().insert(series).values({
      id: "known-dead-cover-with-anilist",
      title: "Known Dead Fallback Test",
      coverUrl: "https://temp.compsci88.com/cover/fallback/known-dead.jpg",
      anilistId: 30013,
    }).run();

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          Media: {
            coverImage: {
              large: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/known-dead.jpg",
            },
          },
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 8, 9]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }));

    const response = await GET(
      new NextRequest("http://localhost/api/media/cover/known-dead-cover-with-anilist"),
      { params: Promise.resolve({ path: ["cover", "known-dead-cover-with-anilist"] }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://graphql.anilist.co",
      "https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/known-dead.jpg",
    ]);
  });

  it("resolves and stores a missing AniList id before using the fallback", async () => {
    getDb().insert(series).values({
      id: "cover-needing-anilist-id",
      title: "Resolve AniList Test",
      coverUrl: "https://temp.compsci88.com/cover/fallback/resolve-id.jpg",
    }).run();
    getDb().insert(sourceMapping).values({
      id: "cover-needing-anilist-id-mapping",
      seriesId: "cover-needing-anilist-id",
      source: "weebcentral",
      sourceSeriesId: "source-resolve-id",
    }).run();

    const getSeriesDetail = vi.fn().mockResolvedValue({
      sourceId: "source-resolve-id",
      title: "Resolve AniList Test",
      slug: "",
      coverUrl: "https://temp.compsci88.com/cover/fallback/resolve-id.jpg",
      description: "",
      authors: [],
      tags: [],
      type: "manga",
      status: "ongoing",
      year: null,
      isAdult: false,
      isOfficial: false,
      anilistUrl: "https://anilist.co/manga/4242",
      relatedSeries: [],
    });
    registerSource({
      name: "weebcentral",
      displayName: "WeebCentral Test",
      baseUrl: "https://weebcentral.com",
      isNsfw: false,
      search: vi.fn().mockResolvedValue([]),
      getSeriesDetail,
      getChapterList: vi.fn().mockResolvedValue([]),
      getChapterPages: vi.fn().mockResolvedValue([]),
    });

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          Media: {
            coverImage: {
              medium: "https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/resolved.jpg",
            },
          },
        },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([10, 11, 12]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }));

    const response = await GET(
      new NextRequest("http://localhost/api/media/cover/cover-needing-anilist-id"),
      { params: Promise.resolve({ path: ["cover", "cover-needing-anilist-id"] }) },
    );

    expect(response.status).toBe(200);
    expect(getSeriesDetail).toHaveBeenCalledWith("source-resolve-id");
    expect(getDb()
      .select({ anilistId: series.anilistId })
      .from(series)
      .where(eq(series.id, "cover-needing-anilist-id"))
      .get()?.anilistId).toBe(4242);
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

  it("uses the source base url as referer and origin when provided", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(new Uint8Array([9, 8, 7]), {
          status: 200,
          headers: { "content-type": "image/webp" },
        }),
      ),
    );

    const requestUrl =
      "http://localhost/api/media/page?url=https://cdn.madaradex.org/manga/test/chapter-1/0.webp&source=madaradex";

    const response = await GET(new NextRequest(requestUrl), {
      params: Promise.resolve({ path: ["page"] }),
    });

    expect(response.status).toBe(200);
    const [pageUrl, pageOptions] = fetchMock.mock.calls[0] ?? [];
    expect(String(pageUrl)).toBe("https://cdn.madaradex.org/manga/test/chapter-1/0.webp");
    expect(pageOptions).toMatchObject({
      headers: expect.objectContaining({
        Referer: "https://madaradex.org/",
        Origin: "https://madaradex.org",
      }),
      redirect: "manual",
    });
  });

  it("rejects invalid referer URLs before proxying", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/media/page?url=https://cdn.example.com/page.webp&referer=%%%"),
      {
        params: Promise.resolve({ path: ["page"] }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid referer URL" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 (not a redirect) when upstream refuses the fetch", async () => {
    // Previously the handler 307-redirected the browser to the raw ?url=
    // query param so the image would still load client-side. That was
    // an open redirect — the server bounced the browser to any
    // attacker-supplied URL under the allowlist. The handler now
    // returns a plain 502 so the URL bar never changes.
    fetchMock.mockImplementation(() => Promise.resolve(new Response("blocked", { status: 403 })));

    const requestUrl =
      "http://localhost/api/media/page?url=https://cdn.madaradex.org/manga/test/chapter-1/blocked.webp&source=madaradex";

    const response = await GET(new NextRequest(requestUrl), {
      params: Promise.resolve({ path: ["page"] }),
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "Upstream refused the request" });
  });
});
