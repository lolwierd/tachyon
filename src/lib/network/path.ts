import { PRIVATE_APP_HOSTNAME } from "@/lib/network/hosts";

export type NetworkRoute = "tailscale" | "cloudflare" | "direct";

export interface NetworkPathStatus {
  route: NetworkRoute;
  host: string | null;
  scheme: string | null;
}

export function detectNetworkPath(headers: Headers): NetworkPathStatus {
  const host = headers.get("host");
  const scheme = headers.get("x-forwarded-proto");
  const normalizedHost = host?.split(":")[0]?.toLowerCase() ?? null;

  if (normalizedHost === PRIVATE_APP_HOSTNAME) {
    return { route: "tailscale", host, scheme: scheme ?? "https" };
  }

  if (headers.has("cf-ray") || headers.has("cf-connecting-ip")) {
    return { route: "cloudflare", host, scheme: scheme ?? "https" };
  }

  return { route: "direct", host, scheme };
}
