import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { logWarn } from "@/lib/server/log";
import { getSource } from "@/lib/sources/registry";

interface FlareSolverrCookie {
  expiry?: number;
  name: string;
  value: string;
}

interface FlareSolverrResponse {
  solution?: {
    userAgent?: string;
    cookies?: FlareSolverrCookie[];
  };
}

interface FlareSolverrState {
  expiresAt: number;
  headers: Record<string, string>;
}

const FALLBACK_TTL_MS = 60 * 60 * 1000;
const WARM_MARGIN_MS = 10 * 60 * 1000;
const STATE_DIR = path.join(process.cwd(), "data", "flaresolverr");
const sessionCache = new Map<string, FlareSolverrState>();
const pendingSessions = new Map<string, Promise<Record<string, string> | null>>();

function getFlareSolverrUrl() {
  const url = process.env.FLARESOLVERR_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

function getStatePath(sourceName: string) {
  return path.join(STATE_DIR, `${sourceName}.json`);
}

function computeExpiresAt(cookies: FlareSolverrCookie[]) {
  const now = Date.now();
  const cookieExpiry = cookies
    .map((cookie) => (typeof cookie.expiry === "number" ? cookie.expiry * 1000 : Number.POSITIVE_INFINITY))
    .filter((expiry) => Number.isFinite(expiry) && expiry > now)
    .sort((left, right) => left - right)[0];

  if (cookieExpiry) {
    return cookieExpiry;
  }

  return now + FALLBACK_TTL_MS;
}

async function readPersistedState(sourceName: string) {
  try {
    const raw = await readFile(getStatePath(sourceName), "utf8");
    const parsed = JSON.parse(raw) as FlareSolverrState;
    if (
      !parsed ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.headers?.Cookie !== "string" ||
      typeof parsed.headers?.["User-Agent"] !== "string"
    ) {
      return null;
    }
    if (parsed.expiresAt <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function persistState(sourceName: string, state: FlareSolverrState) {
  ensureStateDir();
  await writeFile(getStatePath(sourceName), JSON.stringify(state), "utf8");
}

async function requestSession(
  endpoint: string,
  url: string,
  sourceName: string,
) {
  const requestBody = {
    cmd: "request.get",
    url,
    maxTimeout: 60_000,
  };

  const response = await fetch(`${endpoint}/v1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    logWarn("media.flaresolverr.request_failed", {
      source: sourceName,
      status: response.status,
      url,
    });
    return null;
  }

  const responseBody = (await response.json()) as FlareSolverrResponse;
  const cookies = responseBody.solution?.cookies ?? [];
  const userAgent = responseBody.solution?.userAgent ?? null;
  if (!userAgent || cookies.length === 0) {
    logWarn("media.flaresolverr.missing_solution", { source: sourceName, url });
    return null;
  }

  return {
    expiresAt: computeExpiresAt(cookies),
    "User-Agent": userAgent,
    Cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
  };
}

async function getCachedHeaders(sourceName: string) {
  const cached = sessionCache.get(sourceName);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const persisted = await readPersistedState(sourceName);
  if (persisted) {
    sessionCache.set(sourceName, persisted);
    return persisted;
  }

  return null;
}

export async function getFlareSolverrHeaders(
  sourceName: string,
  solveUrl?: string,
  options?: { forceRefresh?: boolean },
) {
  const endpoint = getFlareSolverrUrl();
  if (!endpoint) {
    return null;
  }

  if (!options?.forceRefresh) {
    const cached = await getCachedHeaders(sourceName);
    if (cached) {
      return cached.headers;
    }
  }

  const source = getSource(sourceName);
  if (!source) {
    return null;
  }

  const pending = pendingSessions.get(sourceName);
  if (pending) {
    return pending;
  }

  const urls = Array.from(new Set([solveUrl?.trim(), source.baseUrl].filter(Boolean))) as string[];
  const request = (async () => {
    try {
      for (const url of urls) {
        const solved = await requestSession(endpoint, url, sourceName);
        if (solved) {
          const state = {
            expiresAt: solved.expiresAt,
            headers: {
              "User-Agent": solved["User-Agent"],
              Cookie: solved.Cookie,
            },
          };
          sessionCache.set(sourceName, state);
          await persistState(sourceName, state);
          return state.headers;
        }
      }

      return null;
    } catch (error) {
      logWarn("media.flaresolverr.unavailable", {
        source: sourceName,
        message: error instanceof Error ? error.message : "Unknown error",
      });
      return null;
    } finally {
      pendingSessions.delete(sourceName);
    }
  })();

  pendingSessions.set(sourceName, request);
  return request;
}

export async function warmFlareSolverrHeaders(
  sourceName: string,
  solveUrl?: string,
  options?: { forceRefresh?: boolean },
) {
  const endpoint = getFlareSolverrUrl();
  if (!endpoint) {
    return;
  }

  if (!options?.forceRefresh) {
    const cached = await getCachedHeaders(sourceName);
    if (cached && cached.expiresAt - Date.now() > WARM_MARGIN_MS) {
      return;
    }
  }

  void getFlareSolverrHeaders(sourceName, solveUrl, {
    forceRefresh: options?.forceRefresh ?? true,
  });
}
