import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetcher } from "./fetcher";

const fetchMock = vi.fn();

describe("createFetcher", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeFetcher(overrides?: Record<string, unknown>) {
    return createFetcher({
      name: "TestSource",
      baseUrl: "https://example.com",
      requestDelayMs: 0,
      requestTimeoutMs: 5000,
      maxRetries: 1,
      retryDelayMs: 0,
      ...overrides,
    });
  }

  it("fetches and returns response text", async () => {
    fetchMock.mockResolvedValue(new Response("hello", { status: 200 }));

    const fetcher = makeFetcher();
    const result = await fetcher.fetch("https://example.com/api");

    expect(result).toBe("hello");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sets correct headers including Referer and User-Agent", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    const fetcher = makeFetcher({ userAgent: "CustomBot/1.0" });
    await fetcher.fetch("https://example.com/api", { accept: "application/json" });

    const callArgs = fetchMock.mock.calls[0]!;
    const headers = callArgs[1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("CustomBot/1.0");
    expect(headers["Accept"]).toBe("application/json");
    expect(headers["Referer"]).toBe("https://example.com/");
  });

  it("sets Content-Type when body is provided", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    const fetcher = makeFetcher();
    await fetcher.fetch("https://example.com/api", {
      method: "POST",
      body: JSON.stringify({ key: "value" }),
    });

    const callArgs = fetchMock.mock.calls[0]!;
    const opts = callArgs[1] as RequestInit;
    const headers = opts.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(opts.body).toBe('{"key":"value"}');
    expect(opts.method).toBe("POST");
  });

  it("caches responses and returns cached value on second call", async () => {
    fetchMock.mockResolvedValue(new Response("cached-data", { status: 200 }));

    const fetcher = makeFetcher();
    const first = await fetcher.fetch("https://example.com/api");
    const second = await fetcher.fetch("https://example.com/api");

    expect(first).toBe("cached-data");
    expect(second).toBe("cached-data");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("clearCache resets the cache", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response("data", { status: 200 })),
    );

    const fetcher = makeFetcher();
    await fetcher.fetch("https://example.com/api");
    fetcher.clearCache();
    await fetcher.fetch("https://example.com/api");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on retryable errors", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("down", { status: 503, statusText: "Down" }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const fetcher = makeFetcher({ maxRetries: 1, retryDelayMs: 0 });
    const result = await fetcher.fetch("https://example.com/api");

    expect(result).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry on non-retryable errors", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 403, statusText: "Forbidden" }));

    const fetcher = makeFetcher({ maxRetries: 2 });
    await expect(fetcher.fetch("https://example.com/api")).rejects.toThrow(
      "TestSource request failed: 403 Forbidden",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws after exhausting retries", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 503, statusText: "Down" }));

    const fetcher = makeFetcher({ maxRetries: 1, retryDelayMs: 0 });
    await expect(fetcher.fetch("https://example.com/api")).rejects.toThrow("503 Down");

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("deduplicates inflight requests", async () => {
    let resolveResponse: (value: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    fetchMock.mockReturnValue(responsePromise);

    const fetcher = makeFetcher();
    const p1 = fetcher.fetch("https://example.com/api");
    const p2 = fetcher.fetch("https://example.com/api");

    resolveResponse!(new Response("deduped", { status: 200 }));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("deduped");
    expect(r2).toBe("deduped");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("evictCacheEntries removes matching entries", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response("data", { status: 200 })),
    );

    const fetcher = makeFetcher();
    await fetcher.fetch("https://example.com/api/a");
    await fetcher.fetch("https://example.com/api/b");

    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Evict only /api/a
    fetcher.evictCacheEntries((key) => key.includes("/api/a"));

    await fetcher.fetch("https://example.com/api/a");
    await fetcher.fetch("https://example.com/api/b");

    // /api/a was evicted so re-fetched, /api/b was still cached
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("evicts oldest entries when cache exceeds maxCacheEntries", async () => {
    let callCount = 0;
    fetchMock.mockImplementation(() => {
      callCount++;
      return Promise.resolve(new Response(`data-${callCount}`, { status: 200 }));
    });

    const fetcher = makeFetcher({ maxCacheEntries: 2 });

    await fetcher.fetch("https://example.com/1");
    await fetcher.fetch("https://example.com/2");
    await fetcher.fetch("https://example.com/3");

    // Cache has max 2 entries, so /1 should have been evicted
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // /1 was evicted, so it should trigger a new fetch
    await fetcher.fetch("https://example.com/1");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // /3 should still be cached (most recent)
    await fetcher.fetch("https://example.com/3");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("uses defaultAccept when no accept option provided", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    const fetcher = makeFetcher({ defaultAccept: "application/json" });
    await fetcher.fetch("https://example.com/api");

    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers["Accept"]).toBe("application/json");
  });

  it("appends trailing slash to Referer if missing", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    const fetcher = makeFetcher({ baseUrl: "https://example.com" });
    await fetcher.fetch("https://example.com/api");

    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers["Referer"]).toBe("https://example.com/");
  });

  it("does not double-slash Referer if baseUrl already has trailing slash", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    const fetcher = makeFetcher({ baseUrl: "https://example.com/" });
    await fetcher.fetch("https://example.com/api");

    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers["Referer"]).toBe("https://example.com/");
  });
});
