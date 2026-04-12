import { logError, logWarn } from "@/lib/server/log";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface FetcherConfig {
  name: string;
  baseUrl: string;
  userAgent?: string;
  requestDelayMs?: number;
  requestTimeoutMs?: number;
  cacheTtlMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  maxCacheEntries?: number;
  defaultAccept?: string;
}

export interface FetchOptions {
  method?: string;
  body?: string;
  accept?: string;
}

export interface Fetcher {
  fetch(url: string, options?: FetchOptions): Promise<string>;
  clearCache(): void;
  evictCacheEntries(predicate: (key: string) => boolean): void;
}

interface CacheEntry {
  expiresAt: number;
  value: string;
}

function isRetryableError(error: Error): boolean {
  if (error.name === "AbortError") return true;

  const message = error.message.toLowerCase();
  return (
    message.includes("429")
    || message.includes("500")
    || message.includes("502")
    || message.includes("503")
    || message.includes("504")
    || message.includes("timeout")
    || message.includes("fetch failed")
  );
}

function getCacheKey(url: string, options?: FetchOptions): string {
  return JSON.stringify({
    url,
    method: options?.method || "GET",
    body: options?.body || "",
  });
}

export function createFetcher(config: FetcherConfig): Fetcher {
  const {
    name,
    baseUrl,
    userAgent = DEFAULT_USER_AGENT,
    requestDelayMs = 500,
    requestTimeoutMs = 12000,
    cacheTtlMs = 5 * 60 * 1000,
    maxRetries = 2,
    retryDelayMs = 600,
    maxCacheEntries = 500,
    defaultAccept = "text/html,application/json",
  } = config;

  let lastRequestTime = 0;
  let requestQueue: Promise<void> = Promise.resolve();
  const responseCache = new Map<string, CacheEntry>();
  const inflightRequests = new Map<string, Promise<string>>();

  function clearCache() {
    responseCache.clear();
    inflightRequests.clear();
    lastRequestTime = 0;
    requestQueue = Promise.resolve();
  }

  function evictCacheEntries(predicate: (key: string) => boolean) {
    for (const key of responseCache.keys()) {
      if (predicate(key)) {
        responseCache.delete(key);
      }
    }
  }

  function evictExpired() {
    const now = Date.now();
    for (const [key, entry] of responseCache) {
      if (entry.expiresAt <= now) {
        responseCache.delete(key);
      }
    }
  }

  function evictIfOverLimit() {
    if (responseCache.size <= maxCacheEntries) return;

    evictExpired();
    if (responseCache.size <= maxCacheEntries) return;

    // Evict oldest entries by expiration time
    const entries = [...responseCache.entries()]
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toRemove = entries.slice(0, entries.length - maxCacheEntries);
    for (const [key] of toRemove) {
      responseCache.delete(key);
    }
  }

  function acquireSlot(): Promise<void> {
    const slot = requestQueue.then(async () => {
      const now = Date.now();
      const elapsed = now - lastRequestTime;
      if (elapsed < requestDelayMs) {
        await new Promise((r) => setTimeout(r, requestDelayMs - elapsed));
      }
      lastRequestTime = Date.now();
    });
    requestQueue = slot.catch(() => {});
    return slot;
  }

  async function doFetch(
    url: string,
    options: FetchOptions | undefined,
    cacheKey: string,
  ): Promise<string> {
    await acquireSlot();

    const headers: Record<string, string> = {
      "User-Agent": userAgent,
      "Accept": options?.accept || defaultAccept,
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
    };

    if (options?.body) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

    const res = await fetch(url, {
      method: options?.method || "GET",
      headers,
      body: options?.body,
      redirect: "follow",
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeoutId);
    });

    if (!res.ok) {
      throw new Error(
        `${name} request failed: ${res.status} ${res.statusText} — ${url}`,
      );
    }

    const text = await res.text();
    responseCache.set(cacheKey, {
      expiresAt: Date.now() + cacheTtlMs,
      value: text,
    });
    evictIfOverLimit();
    return text;
  }

  async function throttledFetch(
    url: string,
    options?: FetchOptions,
  ): Promise<string> {
    const cacheKey = getCacheKey(url, options);
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const inflight = inflightRequests.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const requestPromise = (async () => {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          return await doFetch(url, options, cacheKey);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(`Unknown ${name} fetch error`);

          if (isRetryableError(lastError) && attempt < maxRetries) {
            logWarn(`source.${name.toLowerCase()}.retry`, {
              url,
              attempt: attempt + 1,
              message: lastError.message,
            });
          }

          if (!isRetryableError(lastError) || attempt === maxRetries) {
            break;
          }

          await new Promise((resolve) =>
            setTimeout(resolve, retryDelayMs * (attempt + 1)),
          );
        }
      }

      const finalError = lastError ?? new Error(`Unknown ${name} fetch error`);
      logError(`source.${name.toLowerCase()}.request_failed`, finalError, {
        url,
        method: options?.method || "GET",
      });
      throw finalError;
    })();

    inflightRequests.set(cacheKey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      inflightRequests.delete(cacheKey);
    }
  }

  return {
    fetch: throttledFetch,
    clearCache,
    evictCacheEntries,
  };
}
