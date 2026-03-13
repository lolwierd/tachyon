"use client";

import { useEffect } from "react";
import {
  buildHostSwitchUrl,
  isPrivateHost,
  PREFER_TAILSCALE_KEY,
  PRIVATE_APP_HOSTNAME,
} from "@/lib/network/client";

interface NetworkPathResponse {
  route: "tailscale" | "cloudflare" | "direct";
}

export function NetworkRoutePreference() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (isPrivateHost(window.location.hostname)) {
      return;
    }

    const isStandalone = window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    let preferTailscale = false;
    try {
      preferTailscale = window.localStorage.getItem(PREFER_TAILSCALE_KEY) === "1";
    } catch {
      preferTailscale = false;
    }

    if (!preferTailscale) {
      return;
    }

    if (isStandalone) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 1200);

    async function maybeSwitchToPrivateHost() {
      try {
        const currentRes = await fetch("/api/network/path", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!currentRes.ok) {
          return;
        }

        const current = (await currentRes.json()) as NetworkPathResponse;
        if (current.route === "tailscale") {
          return;
        }

        await fetch(
          buildHostSwitchUrl(`${window.location.origin}/api/network/path?probe=1`, PRIVATE_APP_HOSTNAME),
          {
            mode: "no-cors",
            credentials: "omit",
            cache: "no-store",
            signal: controller.signal,
          },
        );

        window.location.replace(buildHostSwitchUrl(window.location.href, PRIVATE_APP_HOSTNAME));
      } catch {
        // Keep the current route when the private host is unavailable.
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void maybeSwitchToPrivateHost();

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);

  return null;
}
