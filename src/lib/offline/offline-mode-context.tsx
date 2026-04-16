"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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

    // Periodic real-reachability check. Only runs when (a) the kernel thinks
    // we're online AND (b) the tab is visible. Gating on visibility avoids
    // burning mobile radio / battery when the PWA is backgrounded — iOS
    // especially punishes apps that keep the network awake in the background.
    // On visibilitychange → visible we cancel any pending timer and tick
    // immediately so the pill reflects the real state when the user comes
    // back, without waiting up to 30s for the next scheduled tick.
    useEffect(() => {
        if (typeof window === "undefined") return;
        let cancelled = false;
        let timer: number | null = null;
        let tickInFlight = false;

        const shouldTick = () =>
            typeof document === "undefined" ||
            document.visibilityState === "visible";

        const scheduleNext = () => {
            if (cancelled) return;
            if (timer !== null) window.clearTimeout(timer);
            timer = window.setTimeout(() => {
                void tick();
            }, HEARTBEAT_INTERVAL_MS);
        };

        const tick = async () => {
            if (cancelled || tickInFlight) return;
            if (!shouldTick()) {
                scheduleNext();
                return;
            }
            tickInFlight = true;
            try {
                if (navigator.onLine) {
                    const ok = await pingHealth();
                    if (!cancelled) setNetworkOnline(ok);
                }
            } finally {
                tickInFlight = false;
                scheduleNext();
            }
        };

        const onVisibilityChange = () => {
            if (!cancelled && shouldTick()) void tick();
        };

        void tick();
        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", onVisibilityChange);
        }

        return () => {
            cancelled = true;
            if (timer !== null) window.clearTimeout(timer);
            if (typeof document !== "undefined") {
                document.removeEventListener("visibilitychange", onVisibilityChange);
            }
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

    // Both refs guard against the same race: an effect that depends on a
    // `useCallback` with mutable closure captures will fire whenever the
    // callback identity changes — here, once per `effectiveOnline` flip.
    // Refs keep the implementation stable so the auto-flush effect only
    // runs when connectivity genuinely changes, and a flushingRef gates
    // against parallel triggerFlush callers beyond what flushOutbox already
    // guards on its own (we also want `flushing` UI state to reflect a
    // single logical drain, not every concurrent caller).
    const effectiveOnlineRef = useRef(effectiveOnline);
    effectiveOnlineRef.current = effectiveOnline;
    const flushingRef = useRef(false);

    const triggerFlush = useCallback(async () => {
        if (!effectiveOnlineRef.current) return;
        if (flushingRef.current) return;
        flushingRef.current = true;
        setFlushing(true);
        try {
            await flushOutbox();
        } finally {
            flushingRef.current = false;
            setFlushing(false);
        }
    }, []);

    // Auto-flush the outbox whenever we're online and there's anything to
    // drain. Covers both the offline→online transition AND the case where
    // an enqueue happens while already online (e.g., a transient 5xx from
    // /api/reader/state). Without re-running on pendingWrites, a legitimate
    // enqueue while online would leave the "N to sync" pill stuck until
    // the next connectivity flip. triggerFlush is stable and flushOutbox
    // has a singleton guard, so bursts coalesce into one real flush.
    useEffect(() => {
        if (!effectiveOnline) return;
        if (pendingWrites === 0) return;
        void triggerFlush();
    }, [effectiveOnline, pendingWrites, triggerFlush]);

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
