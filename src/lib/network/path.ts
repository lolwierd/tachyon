export type NetworkRoute = "tailscale" | "cloudflare" | "direct";

export interface NetworkPathStatus {
  route: NetworkRoute;
  host: string | null;
  scheme: string | null;
}

export function detectNetworkPath(headers: Headers): NetworkPathStatus {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const scheme = headers.get("x-forwarded-proto");
  const privateRoute = headers.get("x-tachyon-route");

  if (privateRoute === "tailscale") {
    return { route: "tailscale", host, scheme: scheme ?? "https" };
  }

  if (headers.has("cf-ray") || headers.has("cf-connecting-ip")) {
    return { route: "cloudflare", host, scheme: scheme ?? "https" };
  }

  return { route: "direct", host, scheme };
}
