import { createHash, randomBytes } from "node:crypto";
import { Resolver } from "node:dns/promises";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { logInfo, logWarn } from "@/lib/server/log";
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

export type MediaOptimization = "page" | "cover";

const OPTIMIZATION_PROFILES = {
    page: {
        maxWidth: 1400,
        quality: 85,
        minSize: 200_000,
        suffix: ".opt.webp",
    },
    cover: {
        // Cover cards top out around 240 CSS pixels. 512px keeps high-DPI
        // displays sharp without shipping full-resolution source artwork.
        maxWidth: 512,
        quality: 78,
        minSize: 50_000,
        suffix: ".cover.webp",
    },
} as const;
const DEFAULT_CHAPTER_WARM_CONCURRENCY = 6;
const MAX_CHAPTER_WARM_CONCURRENCY = 12;
const MAX_REMOTE_MEDIA_BYTES = 50 * 1024 * 1024;
const MAX_CHALLENGE_BODY_BYTES = 256 * 1024;

interface CacheRemotePageOptions {
    forceRefresh?: boolean;
    optimization?: MediaOptimization;
    signal?: AbortSignal;
    sourceName?: string;
    flareSolverrUrl?: string;
}

interface CacheRemotePageResult {
    data: Buffer;
    contentType: string;
    cachePath: string;
    fromCache: boolean;
}

interface WarmChapterPagesOptions {
    chapterKey?: string;
    concurrency?: number;
    referer: string;
    sourceName?: string;
}

const inflightPageRequests = new Map<string, Promise<CacheRemotePageResult>>();
const inflightChapterWarmups = new Map<string, Promise<void>>();

async function optimizeImage(
    data: Buffer,
    optimization: MediaOptimization = "page",
): Promise<{ data: Buffer; contentType: string } | null> {
    try {
        const profile = OPTIMIZATION_PROFILES[optimization];
        const image = sharp(data);
        const metadata = await image.metadata();
        if (!metadata.width || !metadata.format) return null;
        // Skip non-raster formats (SVG, etc.)
        if (!["jpeg", "png", "webp", "avif", "gif"].includes(metadata.format)) return null;
        // Skip small images or already-small files
        if (data.byteLength < profile.minSize) return null;
        // Skip animated images
        if (metadata.pages && metadata.pages > 1) return null;

        let pipeline = image;
        if (metadata.width > profile.maxWidth) {
            pipeline = pipeline.resize(profile.maxWidth, undefined, { withoutEnlargement: true });
        }
        const optimized = await pipeline.webp({ quality: profile.quality }).toBuffer();
        // Only use optimized version if it's actually smaller
        if (optimized.byteLength >= data.byteLength) return null;
        return { data: optimized, contentType: "image/webp" };
    } catch {
        return null;
    }
}

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

/** Return the path for the optimized (webp) variant of a cached image. */
function getOptimizedCachePath(url: string, optimization: MediaOptimization = "page"): string {
    const hash = createHash("sha256").update(url).digest("base64url");
    return path.join(CACHE_DIR, `${hash}${OPTIMIZATION_PROFILES[optimization].suffix}`);
}

function getOptimizationSkipPath(url: string, optimization: MediaOptimization): string {
    const hash = createHash("sha256").update(url).digest("base64url");
    return path.join(CACHE_DIR, `${hash}.${optimization}.skip`);
}

async function writeFileAtomically(filePath: string, data: Buffer) {
    const tmpPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    try {
        await writeFile(tmpPath, data);
        await rename(tmpPath, filePath);
    } catch (error) {
        await unlink(tmpPath).catch(() => {});
        throw error;
    }
}

async function optimizeAndStoreVariant(
    url: string,
    rawData: Buffer,
    optimization: MediaOptimization,
) {
    const optPath = getOptimizedCachePath(url, optimization);
    const skipPath = getOptimizationSkipPath(url, optimization);
    const optimized = await optimizeImage(rawData, optimization);

    if (!optimized) {
        await unlink(optPath).catch(() => {});
        await writeFile(skipPath, "");
        return null;
    }

    await writeFileAtomically(optPath, optimized.data);
    await unlink(skipPath).catch(() => {});
    return optimized;
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

export function parseUpstreamReferer(referer: string) {
    const parsed = new URL(referer);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new TypeError("Invalid referer URL");
    }
    return parsed;
}

export function buildUpstreamMediaHeaders(referer: string, sourceName?: string | null) {
    const parsedReferer = parseUpstreamReferer(referer);
    return {
        Referer: parsedReferer.toString(),
        Origin: parsedReferer.origin,
        ...(sourceName === "madaradex" ? { "sec-fetch-site": "same-site" } : {}),
    };
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
        || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
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
    const withoutBrackets = normalized.replace(/^\[|\]$/g, "");
    if (
        withoutBrackets === "::1"
        || withoutBrackets === "::"
        || withoutBrackets.startsWith("fc")
        || withoutBrackets.startsWith("fd")
        || withoutBrackets.startsWith("fe80:")
    ) {
        return true;
    }

    const mappedIpv4 = withoutBrackets.match(/^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}

function isPrivateIpAddress(address: string) {
    return address.includes(":") ? isPrivateIpv6(address) : isPrivateIpv4(address);
}

async function resolveRemoteAddresses(hostname: string, signal: AbortSignal) {
    const ipFamily = isIP(hostname);
    if (ipFamily) {
        return [{ address: hostname, family: ipFamily }];
    }

    const resolver = new Resolver();
    const cancelResolver = () => resolver.cancel();
    signal.addEventListener("abort", cancelResolver, { once: true });

    try {
        const [ipv4Result, ipv6Result] = await Promise.allSettled([
            resolver.resolve4(hostname),
            resolver.resolve6(hostname),
        ]);

        if (signal.aborted) {
            throw signal.reason ?? new Error("DNS resolution aborted");
        }

        const resolvedAddresses = [
            ...(ipv4Result.status === "fulfilled"
                ? ipv4Result.value.map((address) => ({ address, family: 4 }))
                : []),
            ...(ipv6Result.status === "fulfilled"
                ? ipv6Result.value.map((address) => ({ address, family: 6 }))
                : []),
        ];

        if (resolvedAddresses.length > 0) {
            return resolvedAddresses;
        }

        const firstError = ipv4Result.status === "rejected"
            ? ipv4Result.reason
            : ipv6Result.status === "rejected"
                ? ipv6Result.reason
                : new Error(`Failed to resolve ${hostname}`);
        throw firstError;
    } finally {
        signal.removeEventListener("abort", cancelResolver);
        resolver.cancel();
    }
}

export function isSafeRemoteMediaUrl(url: URL) {
    // https only. Plain http let the response travel in cleartext over
    // whatever local network the origin is on, and also let upstreams
    // tunnel redirects to attacker-chosen http:// hosts without the
    // browser flagging mixed-content. Requiring TLS is cheap insurance.
    if (url.protocol !== "https:") {
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
    const maxRedirects = 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        options?.signal?.throwIfAborted();

        try {
            const timeoutSignal = AbortSignal.timeout(timeoutMs);
            const signal = options?.signal
                ? AbortSignal.any([options.signal, timeoutSignal])
                : timeoutSignal;

            let currentUrl = new URL(url);
            for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
                if (!isSafeRemoteMediaUrl(currentUrl)) {
                    throw new UpstreamFetchError("URL not allowed", 400);
                }

                const lookupHost = currentUrl.hostname.replace(/^\[|\]$/g, "");
                const resolvedAddresses = await resolveRemoteAddresses(lookupHost, signal);
                if (resolvedAddresses.length === 0 || resolvedAddresses.some(({ address }) => isPrivateIpAddress(address))) {
                    throw new UpstreamFetchError("URL not allowed", 400);
                }

                const res = await fetch(currentUrl, {
                    headers: {
                        "User-Agent": USER_AGENT,
                        ...headers,
                    },
                    redirect: "manual",
                    signal,
                });

                if (![301, 302, 303, 307, 308].includes(res.status)) {
                    return res;
                }

                const location = res.headers.get("location");
                if (!location) {
                    return res;
                }

                if (redirectCount === maxRedirects) {
                    throw new UpstreamFetchError("Too many upstream redirects", 502);
                }

                currentUrl = new URL(location, currentUrl);
            }

            throw new UpstreamFetchError("Too many upstream redirects", 502);
        } catch (error) {
            if (options?.signal?.aborted) throw options.signal.reason ?? error;
            if (error instanceof UpstreamFetchError) throw error;
            if (attempt === maxAttempts) throw error;
            // Brief pause before retry
            await new Promise((r) => setTimeout(r, 500 * attempt));
        }
    }

    // Unreachable, but satisfies TS
    throw new Error("fetchUpstream: all attempts failed");
}

function getResponseContentLength(response: Response) {
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    return Number.isFinite(contentLength) && contentLength >= 0 ? contentLength : null;
}

async function readResponseBufferWithinLimit(response: Response, maxBytes: number) {
    const contentLength = getResponseContentLength(response);
    if (contentLength !== null && contentLength > maxBytes) {
        throw new UpstreamFetchError(`Upstream response too large (${contentLength} bytes)`, 413);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        return Buffer.alloc(0);
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            if (!value) {
                continue;
            }

            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
                await reader.cancel();
                throw new UpstreamFetchError(`Upstream response too large (${totalBytes} bytes)`, 413);
            }

            chunks.push(Buffer.from(value));
        }
    } finally {
        reader.releaseLock();
    }

    return Buffer.concat(chunks, totalBytes);
}

async function readResponseTextWithinLimit(response: Response, maxBytes: number) {
    const contentLength = getResponseContentLength(response);
    if (contentLength !== null && contentLength > maxBytes) {
        return null;
    }

    const reader = response.body?.getReader();
    if (!reader) {
        return "";
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            if (!value) {
                continue;
            }

            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
                await reader.cancel();
                return null;
            }

            chunks.push(Buffer.from(value));
        }
    } catch {
        return null;
    } finally {
        reader.releaseLock();
    }

    return Buffer.concat(chunks, totalBytes).toString("utf8").toLowerCase();
}

function normalizeRemoteContentType(contentType: string | null, cachePath: string) {
    const candidate = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (candidate.startsWith("image/") && candidate !== "image/svg+xml") {
        return candidate;
    }

    const fallback = contentTypeFromExt(cachePath);
    if (fallback.startsWith("image/") && fallback !== "image/svg+xml") {
        return fallback;
    }

    return "application/octet-stream";
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
        const body = await readResponseTextWithinLimit(response.clone(), MAX_CHALLENGE_BODY_BYTES);
        return body ? CLOUDFLARE_BODY_HINTS.some((hint) => body.includes(hint)) : false;
    } catch {
        return false;
    }
}

/** Stream a cached page directly from disk without buffering the entire file. Prefers optimized webp variant. */
export function streamCachedPage(
    url: string,
    optimization: MediaOptimization = "page",
): {
    stream: ReadableStream;
    contentType: string;
    size: number;
} | null {
    ensureMediaCacheDir();

    const optPath = getOptimizedCachePath(url, optimization);
    const rawPath = getCachePath(url);
    let servePath = optPath;

    if (!existsSync(servePath)) {
        if (!existsSync(rawPath)) return null;

        const rawStat = statSync(rawPath);
        const skipPath = getOptimizationSkipPath(url, optimization);
        const isTooSmallToOptimize = rawStat.size < OPTIMIZATION_PROFILES[optimization].minSize;
        if (!isTooSmallToOptimize && !existsSync(skipPath)) {
            // Let cacheRemotePage create the requested variant before the
            // immutable response reaches the browser or service worker.
            return null;
        }
        servePath = rawPath;
    }

    try {
        const fileStat = statSync(servePath);
        const nodeStream = createReadStream(servePath);
        const stream = Readable.toWeb(nodeStream) as ReadableStream;
        return {
            stream,
            contentType: contentTypeFromExt(servePath),
            size: fileStat.size,
        };
    } catch {
        return null;
    }
}

function normalizeWarmConcurrency(concurrency?: number) {
    if (!Number.isFinite(concurrency)) {
        return DEFAULT_CHAPTER_WARM_CONCURRENCY;
    }

    return Math.min(Math.max(Math.trunc(concurrency!), 1), MAX_CHAPTER_WARM_CONCURRENCY);
}

async function runWithConcurrency<T>(
    items: readonly T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>,
) {
    let nextIndex = 0;

    async function runWorker() {
        while (true) {
            const currentIndex = nextIndex;
            if (currentIndex >= items.length) {
                return;
            }

            nextIndex += 1;
            await worker(items[currentIndex], currentIndex);
        }
    }

    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

export async function cacheRemotePage(
    url: string,
    headers?: Record<string, string>,
    options?: CacheRemotePageOptions,
): Promise<CacheRemotePageResult> {
    ensureMediaCacheDir();
    const cachePath = getCachePath(url);
    const optimization = options?.optimization ?? "page";
    const optPath = getOptimizedCachePath(url, optimization);
    const skipPath = getOptimizationSkipPath(url, optimization);
    const dedupeKey = !options?.forceRefresh && !options?.signal
        ? `${optimization}:${url}`
        : null;
    if (dedupeKey) {
        const inflight = inflightPageRequests.get(dedupeKey);
        if (inflight) {
            return inflight;
        }
    }

    const requestPromise = (async (): Promise<CacheRemotePageResult> => {
        options?.signal?.throwIfAborted();

        if (!options?.forceRefresh) {
            if (existsSync(optPath)) {
                const data = await readFile(optPath);
                return {
                    data,
                    contentType: contentTypeFromExt(optPath),
                    cachePath,
                    fromCache: true,
                };
            }

            if (existsSync(cachePath)) {
                const rawData = await readFile(cachePath);
                if (
                    existsSync(skipPath)
                    || rawData.byteLength < OPTIMIZATION_PROFILES[optimization].minSize
                ) {
                    return {
                        data: rawData,
                        contentType: contentTypeFromExt(cachePath),
                        cachePath,
                        fromCache: true,
                    };
                }

                const optimized = await optimizeAndStoreVariant(url, rawData, optimization);
                return {
                    data: optimized?.data ?? rawData,
                    contentType: optimized?.contentType ?? contentTypeFromExt(cachePath),
                    cachePath,
                    fromCache: true,
                };
            }

            if (optimization === "cover") {
                const pageVariantPath = getOptimizedCachePath(url, "page");
                if (existsSync(pageVariantPath)) {
                    const pageVariant = await readFile(pageVariantPath);
                    const optimized = await optimizeAndStoreVariant(url, pageVariant, optimization);
                    return {
                        data: optimized?.data ?? pageVariant,
                        contentType: optimized?.contentType ?? contentTypeFromExt(pageVariantPath),
                        cachePath,
                        fromCache: true,
                    };
                }
            }
        }

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

        const rawData = await readResponseBufferWithinLimit(res, MAX_REMOTE_MEDIA_BYTES);
        const rawContentType = normalizeRemoteContentType(res.headers.get("content-type"), cachePath);

        // Write atomically: dump to a unique temp file in the same directory,
        // then rename into the final path. rename(2) is atomic on POSIX so
        // concurrent writers can't clobber each other mid-flush, and a
        // crash between the write and the rename leaves no partial file
        // at the final path (a subsequent reader's existsSync(cachePath)
        // would correctly miss). The unique suffix keeps two concurrent
        // writers from racing on the temp name itself.
        await writeFileAtomically(cachePath, rawData);

        // The response URL is immutable and is also stored by the service
        // worker. Build the final variant before returning so a cold request
        // cannot permanently cache a multi-megabyte source image in clients.
        const optimized = await optimizeAndStoreVariant(url, rawData, optimization);

        return {
            data: optimized?.data ?? rawData,
            contentType: optimized?.contentType ?? rawContentType,
            cachePath,
            fromCache: false,
        };
    })();

    if (dedupeKey) {
        inflightPageRequests.set(dedupeKey, requestPromise);
    }

    try {
        return await requestPromise;
    } finally {
        if (dedupeKey) {
            inflightPageRequests.delete(dedupeKey);
        }
    }
}

export function warmChapterPages(
    pageUrls: readonly string[],
    options: WarmChapterPagesOptions,
): Promise<void> {
    const uniqueUrls = Array.from(new Set(pageUrls.filter(Boolean)));
    if (uniqueUrls.length === 0) {
        return Promise.resolve();
    }

    const chapterKey = options.chapterKey ?? `${options.sourceName ?? "unknown"}:${uniqueUrls[0]}:${uniqueUrls.length}`;
    const existing = inflightChapterWarmups.get(chapterKey);
    if (existing) {
        return existing;
    }

    const headers = buildUpstreamMediaHeaders(options.referer, options.sourceName);
    const concurrency = normalizeWarmConcurrency(options.concurrency);
    const warmPromise = (async () => {
        let cacheHits = 0;
        let cacheMisses = 0;
        let failures = 0;

        await runWithConcurrency(uniqueUrls, concurrency, async (url) => {
            try {
                const result = await cacheRemotePage(url, headers, {
                    sourceName: options.sourceName,
                    flareSolverrUrl: options.referer,
                });
                if (result.fromCache) {
                    cacheHits += 1;
                } else {
                    cacheMisses += 1;
                }
            } catch (error) {
                failures += 1;
                logWarn("media.cache.chapter_warm_failed", {
                    chapterKey,
                    source: options.sourceName ?? null,
                    url,
                    message: error instanceof Error ? error.message : "Unknown error",
                });
            }
        });

        logInfo("media.cache.chapter_warmed", {
            chapterKey,
            source: options.sourceName ?? null,
            totalPages: uniqueUrls.length,
            cacheHits,
            cacheMisses,
            failures,
        });
    })();

    inflightChapterWarmups.set(chapterKey, warmPromise);
    return warmPromise.finally(() => {
        inflightChapterWarmups.delete(chapterKey);
    });
}

/** Optimize all cached images that don't have an .opt.webp variant yet. Keeps originals for pin manifests. */
export async function optimizeAllCachedImages(): Promise<{
    processed: number;
    optimized: number;
    removedBytes: number;
    skipped: number;
}> {
    ensureMediaCacheDir();
    const entries = await readdir(CACHE_DIR, { withFileTypes: true });
    const imageExts = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);

    let processed = 0;
    let optimized = 0;
    let removedBytes = 0;
    let skipped = 0;

    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name).toLowerCase();
        // Skip already-optimized variants, manifests, and non-image files
        if (entry.name.includes(".opt.")) continue;
        if (!imageExts.has(ext)) continue;

        const filePath = path.join(CACHE_DIR, entry.name);
        const baseName = entry.name.replace(/\.[^.]+$/, "");
        const optPath = path.join(CACHE_DIR, `${baseName}.opt.webp`);

        // Already has optimized variant
        if (existsSync(optPath)) {
            skipped += 1;
            continue;
        }

        processed += 1;
        try {
            const data = await readFile(filePath);
            const result = await optimizeImage(data);
            if (result) {
                await writeFile(optPath, result.data);
                optimized += 1;
            } else {
                skipped += 1;
            }
        } catch {
            skipped += 1;
        }

        // Yield to event loop every 20 images to avoid blocking
        if (processed % 20 === 0) {
            await new Promise((r) => setTimeout(r, 0));
        }
    }

    logInfo("media.cache.optimize_all", { processed, optimized, removedBytes, skipped });
    return { processed, optimized, removedBytes, skipped };
}
