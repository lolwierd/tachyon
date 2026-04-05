import { createHash, timingSafeEqual } from "node:crypto";
import { detectNetworkPath } from "@/lib/network/path";
import { PRIVATE_APP_HOSTNAME, PUBLIC_APP_HOSTNAME } from "@/lib/network/hosts";

export const BASIC_AUTH_USERNAME_ENV = "TACHYON_BASIC_AUTH_USERNAME";
export const BASIC_AUTH_PASSWORD_ENV = "TACHYON_BASIC_AUTH_PASSWORD";

export interface BasicAuthConfig {
  username: string;
  password: string;
}

function normalizeHost(host: string | null) {
  if (!host) {
    return null;
  }

  if (host.startsWith("[")) {
    const closing = host.indexOf("]");
    return closing >= 0 ? host.slice(1, closing).toLowerCase() : host.toLowerCase();
  }

  return host.split(":")[0]?.toLowerCase() ?? null;
}

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isPrivateIpv6(hostname: string) {
  const normalized = hostname.toLowerCase();
  const withoutBrackets = normalized.replace(/^\[|\]$/g, "");

  if (
    withoutBrackets === "::1" ||
    withoutBrackets === "::" ||
    withoutBrackets.startsWith("fc") ||
    withoutBrackets.startsWith("fd") ||
    withoutBrackets.startsWith("fe80:")
  ) {
    return true;
  }

  const mappedIpv4 = withoutBrackets.match(/^(?:::ffff:)(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  return mappedIpv4 ? isPrivateIpv4(mappedIpv4) : false;
}

export function isTrustedPrivateHost(host: string | null) {
  const normalized = normalizeHost(host);
  if (!normalized) {
    return false;
  }

  if (
    normalized === "localhost" ||
    normalized === PRIVATE_APP_HOSTNAME ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".home.arpa")
  ) {
    return true;
  }

  if (normalized.includes(":")) {
    return isPrivateIpv6(normalized);
  }

  return isPrivateIpv4(normalized);
}

export function getBasicAuthConfig(): BasicAuthConfig | null {
  const username = process.env[BASIC_AUTH_USERNAME_ENV]?.trim();
  const password = process.env[BASIC_AUTH_PASSWORD_ENV];

  if (!username || !password) {
    return null;
  }

  return { username, password };
}

export function decodeBasicAuthHeader(value: string | null) {
  if (!value?.startsWith("Basic ")) {
    return null;
  }

  try {
    const decoded = atob(value.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) {
      return null;
    }

    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function constantTimeEquals(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function matchesBasicAuth(headers: Headers, config = getBasicAuthConfig()) {
  if (!config) {
    return false;
  }

  const credentials = decodeBasicAuthHeader(headers.get("authorization"));
  return Boolean(
    credentials &&
    constantTimeEquals(credentials.username, config.username) &&
    constantTimeEquals(credentials.password, config.password),
  );
}

export function requiresPublicAuth(headers: Headers) {
  const { route, host } = detectNetworkPath(headers);
  const normalizedHost = normalizeHost(host);

  if (route === "tailscale" || isTrustedPrivateHost(host)) {
    return false;
  }

  return route === "cloudflare" || normalizedHost === PUBLIC_APP_HOSTNAME;
}
