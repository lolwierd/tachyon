import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const CACHE_DIR = path.join(process.cwd(), "data", "media-cache");
export const PIN_MANIFEST_DIR = path.join(CACHE_DIR, "pins");

const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const ALLOWED_PAGE_DOMAINS = [
    "hot.planeptune.us",
    "scans-hot.planeptune.us",
    "static.comix.to",
    "temp.compsci88.com",
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

export function isAllowedPageDomain(hostname: string) {
    const lower = hostname.toLowerCase();
    return ALLOWED_PAGE_DOMAINS.includes(lower) || lower.endsWith(".planeptune.us");
}

export async function fetchUpstream(
    url: string,
    headers?: Record<string, string>,
): Promise<Response> {
    return fetch(url, {
        headers: {
            "User-Agent": USER_AGENT,
            ...headers,
        },
    });
}

export async function cacheRemotePage(
    url: string,
    headers?: Record<string, string>,
    options?: { forceRefresh?: boolean },
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

    const res = await fetchUpstream(url, headers);
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
