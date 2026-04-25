"use client";

import { useEffect, useState } from "react";
import { CloudOff, UploadCloud, WifiOff } from "lucide-react";
import { usePathname } from "next/navigation";
import { useOfflineMode } from "@/lib/offline/offline-mode-context";
import { cn } from "@/lib/utils";

// Small persistent pill near the top-right edge. Visible whenever the user
// should know the app isn't talking to the server — either the network is
// down, they've toggled manual offline, or we have unsynced writes pending.
// Deliberately minimal: too-loud indicators become noise and users tune
// them out. The pill is non-interactive; controls live in /manage.
export function OfflineIndicator() {
    const { networkOnline, manualOffline, isOffline, pendingWrites, flushing } = useOfflineMode();
    const pathname = usePathname();
    // The reader routes render a full-width top bar with chapter title /
    // settings / close at the top. Drop the pill below that bar so it
    // doesn't cover controls.
    const inReader = pathname?.startsWith("/read/") ?? false;

    // Avoid hydration mismatch: the server has no access to navigator.onLine
    // or to localStorage, so its first render always thinks "online, no
    // manual offline" and returns null. A client whose localStorage has
    // manual-offline set, or whose navigator.onLine is already false,
    // would render the pill instead — and React's hydration cares about
    // that tree shape. Hold the pill back until after mount so the first
    // render always matches SSR; the effect below flips us into the real
    // state immediately on the client.
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return null;
    if (!isOffline && pendingWrites === 0 && !flushing) return null;

    let label: string;
    let Icon = WifiOff;
    let tone: "offline" | "manual" | "sync" = "offline";

    if (flushing) {
        label = `Syncing ${pendingWrites || ""}`.trim();
        Icon = UploadCloud;
        tone = "sync";
    } else if (pendingWrites > 0 && !isOffline) {
        label = `${pendingWrites} to sync`;
        Icon = UploadCloud;
        tone = "sync";
    } else if (manualOffline) {
        label = "Offline mode";
        Icon = CloudOff;
        tone = "manual";
    } else if (!networkOnline) {
        label = "You're offline";
        Icon = WifiOff;
        tone = "offline";
    } else {
        // Covers the rare "network says up, health check says down" gap.
        label = "Server unreachable";
        Icon = CloudOff;
        tone = "offline";
    }

    return (
        <div
            // viewportFit: "cover" is set in the root metadata so the page
            // extends into the notch / Dynamic Island area. Without a safe
            // inset, the pill sits beneath the status bar icons and gets
            // visually mangled. env(safe-area-inset-top) gives us the real
            // offset reported by the OS; max() clamps to 0.75rem so the
            // pill isn't flush against the top edge on non-notch devices.
            // In the reader we add ~3.5rem on top of that for the chapter
            // top bar.
            className={cn(
                "pointer-events-none fixed right-3 z-[60] flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm backdrop-blur",
                tone === "offline" && "border-red-400/40 bg-red-500/10 text-red-200",
                tone === "manual" && "border-accent/40 bg-accent/10 text-accent",
                tone === "sync" && "border-accent/40 bg-accent/10 text-accent",
            )}
            style={{
                top: inReader
                    ? "calc(env(safe-area-inset-top, 0px) + 3.5rem)"
                    : "max(0.75rem, env(safe-area-inset-top, 0.75rem))",
            }}
            role="status"
            aria-live="polite"
        >
            <Icon className={cn("h-3 w-3", flushing && "animate-pulse")} />
            <span>{label}</span>
        </div>
    );
}
