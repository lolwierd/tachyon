"use client";

import { useEffect, useState } from "react";
import { buildHostSwitchUrl, PRIVATE_APP_HOSTNAME, PREFER_TAILSCALE_KEY } from "@/lib/network/client";
import { cn } from "@/lib/utils";

interface NetworkPathResponse {
  route: "tailscale" | "cloudflare" | "direct";
}

export function TailscaleSwitchBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const isStandalone = window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (!isStandalone) {
      return;
    }

    let preferTailscale = false;
    try {
      preferTailscale = window.localStorage.getItem(PREFER_TAILSCALE_KEY) === "1";
    } catch {
      preferTailscale = false;
    }

    if (!preferTailscale) {
      return;
    }

    let cancelled = false;

    async function checkRoute() {
      try {
        const res = await fetch("/api/network/path", { cache: "no-store" });
        if (!res.ok || cancelled) {
          return;
        }

        const body = (await res.json()) as NetworkPathResponse;
        if (!cancelled) {
          setVisible(body.route === "cloudflare");
        }
      } catch {
        if (!cancelled) {
          setVisible(false);
        }
      }
    }

    void checkRoute();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[70] md:left-[calc(var(--sidebar-collapsed)+1rem)] md:right-4">
      <div className="flex items-center gap-3 rounded-sm border border-accent/30 bg-void/95 px-3 py-2 text-xs text-text shadow-lg backdrop-blur">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-text">Tailscale route available</p>
          <p className="text-text-faint">
            This installed app is currently using Cloudflare. Open the private host for the faster Tailscale path.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.location.assign(buildHostSwitchUrl(window.location.href, PRIVATE_APP_HOSTNAME))}
          className={cn(
            "shrink-0 rounded-sm border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/15",
          )}
        >
          Open Tailscale Host
        </button>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="shrink-0 rounded-sm border border-border px-2 py-1.5 text-[11px] text-text-faint transition-colors hover:text-text"
          aria-label="Dismiss Tailscale banner"
        >
          Later
        </button>
      </div>
    </div>
  );
}
