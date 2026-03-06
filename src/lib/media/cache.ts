import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sourceRequiresFlareSolverr } from "@/lib/sources/registry";
import { getFlareSolverrHeaders } from "./flaresolverr";

export const CACHE_DIR = path.join(process.cwd(), "data", "media-cache");
export const PIN_MANIFEST_DIR = path.join(CACHE_DIR, "pins");

const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const CLOUDFLARE_BODY_HINTS = [
    "cloudflare",
    "attention required",
    "just a moment",
    "cf-browser-verification",
    "challenge-platform",
    "cdn-cgi/challenge-platform",
];

export class UpstreamFetchError extends Error {
    constructor(
        message: string,
        public readonly status: number,
    ) {
        super(message);
    }
}

export function ensureMediaCacheDir() {
    if (!existsSync(CACHE_DIR)) {
        mkdirSync(CACHE_DIR, { recursive: true });
    }
}

export function ensurePinManifestDir() {
    ensureMediaCacheDir();
    if (!existsSync(PIN_MANIFEST_DIR)) {
        mkdirSync(PIN_MANIFEST_DIR, { recursive: true });
    }
}

export function getCachePath(url: string): string {
    const hash = createHash("sha256").update(url).digest("base64url");
    const ext = path.extname(new URL(url).pathname) || ".jpg";
    return path.join(CACHE_DIR, `${hash}${ext}`);
}

export function contentTypeFromExt(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const types: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".avif": "image/avif",
    };
    return types[ext] || "application/octet-stream";
}

function isPrivateIpv4(hostname: string) {
    const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
        return false;
    }

    return (
        parts[0] === 10
        || parts[0] === 127
        || parts[0] === 0
        || (parts[0] === 169 && parts[1] === 254)
        || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || (parts[0] === 192 && parts[1] === 168)
    );
}

function isIpv6Literal(hostname: string) {
    return hostname.includes(":");
}

function isPrivateIpv6(hostname: string) {
    const normalized = hostname.toLowerCase();
    return (
        normalized === "::1"
        || normalized === "::"
        || normalized.startsWith("fc")
        || normalized.startsWith("fd")
        || normalized.startsWith("fe80:")
        || normalized === "[::1]"
        || normalized === "[::]"
    );
}

export function isSafeRemoteMediaUrl(url: URL) {
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        return false;
    }

    const hostname = url.hostname.toLowerCase();
    if (!hostname) {
        return false;
    }

    if (
        hostname === "localhost"
        || hostname.endsWith(".localhost")
        || hostname.endsWith(".local")
        || hostname.endsWith(".internal")
        || hostname.endsWith(".home.arpa")
    ) {
        return false;
    }

    if (isPrivateIpv4(hostname)) {
        return false;
    }

    if (isIpv6Literal(hostname) && isPrivateIpv6(hostname.replace(/^\[|\]$/g, ""))) {
        return false;
    }

    return true;
}

export async function fetchUpstream(
    url: string,
    headers?: Record<string, string>,
    options?: { signal?: AbortSignal },
): Promise<Response> {
    const maxAttempts = 3;
    const timeoutMs = 15_000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        options?.signal?.throwIfAborted();

        try {
            const timeoutSignal = AbortSignal.timeout(timeoutMs);
            const signal = options?.signal
                ? AbortSignal.any([options.signal, timeoutSignal])
                : timeoutSignal;

            const res = await fetch(url, {
                headers: {
                    "User-Agent": USER_AGENT,
                    ...headers,
                },
                signal,
            });
            return res;
        } catch (error) {
            if (options?.signal?.aborted) throw options.signal.reason ?? error;
            if (attempt === maxAttempts) throw error;
            // Brief pause before retry
            await new Promise((r) => setTimeout(r, 500 * attempt));
        }
    }

    // Unreachable, but satisfies TS
    throw new Error("fetchUpstream: all attempts failed");
}

async function isCloudflareChallengeResponse(response: Response) {
    if (response.status !== 403 && response.status !== 503) {
        return false;
    }

    const serverHeader = response.headers.get("server")?.toLowerCase() ?? "";
    if (serverHeader.includes("cloudflare")) {
        return true;
    }

    if (response.headers.has("cf-ray") || response.headers.has("cf-mitigated")) {
        return true;
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
        return false;
    }

    try {
        const body = (await response.clone().text()).toLowerCase();
        return CLOUDFLARE_BODY_HINTS.some((hint) => body.includes(hint));
    } catch {
        return false;
    }
}

export async function cacheRemotePage(
    url: string,
    headers?: Record<string, string>,
    options?: {
        forceRefresh?: boolean;
        signal?: AbortSignal;
        sourceName?: string;
        flareSolverrUrl?: string;
    },
): Promise<{
    data: Buffer;
    contentType: string;
    cachePath: string;
    fromCache: boolean;
}> {
    ensureMediaCacheDir();
    const cachePath = getCachePath(url);

    if (!options?.forceRefresh && existsSync(cachePath)) {
        const data = await readFile(cachePath);
        return {
            data,
            contentType: contentTypeFromExt(cachePath),
            cachePath,
            fromCache: true,
        };
    }

    options?.signal?.throwIfAborted();
    const sourceName = options?.sourceName;
    const alwaysUseFlareSolverr = sourceName
        ? sourceRequiresFlareSolverr(sourceName)
        : false;

    const fetchWithFlareSolverr = async (forceRefresh = false) => {
        if (!sourceName) {
            return null;
        }

        const flaresolverrHeaders = await getFlareSolverrHeaders(
            sourceName,
            options?.flareSolverrUrl,
            forceRefresh ? { forceRefresh: true } : undefined,
        );
        if (!flaresolverrHeaders) {
            return null;
        }

        return fetchUpstream(
            url,
            {
                ...headers,
                ...flaresolverrHeaders,
            },
            { signal: options?.signal },
        );
    };

    let res: Response;

    if (alwaysUseFlareSolverr) {
        const solved = await fetchWithFlareSolverr();
        res = solved ?? await fetchUpstream(url, headers, { signal: options?.signal });

        if (!res.ok && (res.status === 401 || res.status === 403)) {
            const refreshed = await fetchWithFlareSolverr(true);
            if (refreshed) {
                res = refreshed;
            }
        }
    } else {
        res = await fetchUpstream(url, headers, { signal: options?.signal });

        if (!res.ok && res.status === 403 && sourceName) {
            const isCloudflareChallenge = await isCloudflareChallengeResponse(res);
            if (isCloudflareChallenge) {
                const solved = await fetchWithFlareSolverr();
                if (solved) {
                    res = solved;
                }

                if (!res.ok && res.status === 403) {
                    const refreshed = await fetchWithFlareSolverr(true);
                    if (refreshed) {
                        res = refreshed;
                    }
                }
            }
        }
    }

    if (!res.ok) {
        throw new UpstreamFetchError(`Upstream fetch failed (${res.status})`, res.status);
    }

    const data = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || contentTypeFromExt(cachePath);
    await writeFile(cachePath, data);

    return {
        data,
        contentType,
        cachePath,
        fromCache: false,
    };
}
