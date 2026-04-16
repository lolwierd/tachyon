"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { flushOutbox, getOutboxCount, subscribeOutbox } from "./outbox";

const MANUAL_OFFLINE_KEY = "offline:mode-enabled";

// Navigator.onLine is famously optimistic — it reports true as soon as the OS
// has any network interface up, even if that interface can't reach the origin
// (Wi-Fi with no internet, Cloudflare tunnel down, etc). We treat it as a
// hint and confirm with a cheap /api/health ping so the indicator reflects
// reality, not the kernel's opinion.
const HEARTBEAT_URL = "/api/health";
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 4_000;

interface OfflineModeState {
    networkOnline: boolean;
    manualOffline: boolean;
    isOffline: boolean;
    pendingWrites: number;
    flushing: boolean;
    setManualOffline: (value: boolean) => void;
    triggerFlush: () => Promise<void>;
}

const OfflineModeContext = createContext<OfflineModeState | null>(null);

function readManualOffline(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return window.localStorage.getItem(MANUAL_OFFLINE_KEY) === "1";
    } catch {
        return false;
    }
}

async function pingHealth(): Promise<boolean> {
    if (typeof fetch === "undefined") return false;
    const controller = new AbortController();
    const timer = typeof window !== "undefined"
        ? window.setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS)
        : null;
    try {
        const res = await fetch(HEARTBEAT_URL, {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
            credentials: "same-origin",
        });
        return res.ok;
    } catch {
        return false;
    } finally {
        if (timer !== null && typeof window !== "undefined") window.clearTimeout(timer);
    }
}

export function OfflineModeProvider({ children }: { children: React.ReactNode }) {
    const [networkOnline, setNetworkOnline] = useState<boolean>(() =>
        typeof navigator === "undefined" ? true : navigator.onLine,
    );
    const [manualOffline, setManualOfflineState] = useState<boolean>(() => readManualOffline());
    const [pendingWrites, setPendingWrites] = useState(0);
    const [flushing, setFlushing] = useState(false);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const onOnline = () => setNetworkOnline(true);
        const onOffline = () => setNetworkOnline(false);
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        return () => {
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
        };
    }, []);

    // Periodic real-reachability check. Only runs when the kernel thinks we're
    // online; when offline, we trust navigator.onLine until it flips back.
    // This catches the "Wi-Fi connected but Cloudflare tunnel dead" case.
    useEffect(() => {
        if (typeof window === "undefined") return;
        let cancelled = false;
        let timer: number | null = null;
        const tick = async () => {
            if (cancelled) return;
            if (navigator.onLine) {
                const ok = await pingHealth();
                if (!cancelled) setNetworkOnline(ok);
            }
            timer = window.setTimeout(tick, HEARTBEAT_INTERVAL_MS);
        };
        void tick();
        return () => {
            cancelled = true;
            if (timer !== null) window.clearTimeout(timer);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        void getOutboxCount().then((count) => {
            if (!cancelled) setPendingWrites(count);
        });
        const unsubscribe = subscribeOutbox((count) => {
            if (!cancelled) setPendingWrites(count);
        });
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, []);

    const effectiveOnline = networkOnline && !manualOffline;

    const triggerFlush = useCallback(async () => {
        if (!effectiveOnline) return;
        setFlushing(true);
        try {
            await flushOutbox();
        } finally {
            setFlushing(false);
        }
    }, [effectiveOnline]);

    // Auto-flush the outbox when we transition back online. The user shouldn't
    // have to think about this — progress saved offline should silently
    // materialize on the server the moment we reach it.
    useEffect(() => {
        if (!effectiveOnline) return;
        void triggerFlush();
    }, [effectiveOnline, triggerFlush]);

    const setManualOffline = useCallback((value: boolean) => {
        setManualOfflineState(value);
        if (typeof window !== "undefined") {
            try {
                if (value) window.localStorage.setItem(MANUAL_OFFLINE_KEY, "1");
                else window.localStorage.removeItem(MANUAL_OFFLINE_KEY);
            } catch {
                // localStorage may be disabled in private mode — still honor
                // the in-memory toggle for this session.
            }
        }
    }, []);

    const value = useMemo<OfflineModeState>(
        () => ({
            networkOnline,
            manualOffline,
            isOffline: !effectiveOnline,
            pendingWrites,
            flushing,
            setManualOffline,
            triggerFlush,
        }),
        [networkOnline, manualOffline, effectiveOnline, pendingWrites, flushing, setManualOffline, triggerFlush],
    );

    return <OfflineModeContext.Provider value={value}>{children}</OfflineModeContext.Provider>;
}

export function useOfflineMode(): OfflineModeState {
    const ctx = useContext(OfflineModeContext);
    if (!ctx) {
        // Graceful fallback for components rendered outside the provider
        // (e.g., unit tests that don't wrap the tree). Treat as always online
        // with no writes pending so callers never see undefined.
        return {
            networkOnline: true,
            manualOffline: false,
            isOffline: false,
            pendingWrites: 0,
            flushing: false,
            setManualOffline: () => {},
            triggerFlush: async () => {},
        };
    }
    return ctx;
}
