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
// Default poll cadence while things look healthy. Short enough that an
// offline→online transition is reflected in the pill within a few seconds
// even when the OS doesn't fire the `online` event (common on Cloudflare
// tunnel flaps where the Wi-Fi link stayed up).
const HEARTBEAT_INTERVAL_MS = 10_000;
// After a failed ping OR a flush that bailed mid-drain (5xx), we poll
// faster so the "N to sync" pill clears quickly once the server recovers
// instead of lingering up to a full interval.
const HEARTBEAT_FAST_RETRY_MS = 3_000;
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

    // Refs so the heartbeat loop can see current values without re-subscribing.
    // triggerFlush is defined below; declared here so the effect closure
    // captures the ref, not the function identity.
    const pendingWritesRef = useRef(pendingWrites);
    pendingWritesRef.current = pendingWrites;
    const manualOfflineRef = useRef(manualOffline);
    manualOfflineRef.current = manualOffline;
    const triggerFlushRef = useRef<() => Promise<void>>(async () => {});

    // Periodic real-reachability check. Only runs when (a) the kernel thinks
    // we're online AND (b) the tab is visible. Gating on visibility avoids
    // burning mobile radio / battery when the PWA is backgrounded — iOS
    // especially punishes apps that keep the network awake in the background.
    //
    // Two cadences:
    //   * 10s when things are healthy — fast enough for the pill to track
    //     reality without being a drain.
    //   * 3s after a failed ping OR a flush that bailed on a 5xx — shortens
    //     the "stuck at N to sync" window once the server recovers.
    //
    // On visibilitychange → visible OR window focus we tick immediately so the
    // pill reflects the real state when the user comes back without waiting
    // out the current timer.
    //
    // On every successful ping with pending writes we retry the flush. Before
    // this, a single 5xx during auto-flush left the outbox drained-but-not-
    // empty with nothing to wake it back up: effectiveOnline was already true
    // and pendingWrites hadn't changed, so the auto-flush effect never
    // re-fired. The heartbeat is the only thing guaranteed to poll while
    // online, so we piggyback the retry here.
    useEffect(() => {
        if (typeof window === "undefined") return;
        let cancelled = false;
        let timer: number | null = null;
        let tickInFlight = false;
        let consecutiveFailures = 0;

        const shouldTick = () =>
            typeof document === "undefined" ||
            document.visibilityState === "visible";

        const scheduleNext = () => {
            if (cancelled) return;
            if (timer !== null) window.clearTimeout(timer);
            // Fast retry when we're unhealthy OR when there are pending writes
            // we haven't been able to drain yet — both states want a quick
            // recheck so the UI unsticks promptly. Manual offline suppresses
            // the fast retry because there's nothing to recheck against.
            const degraded =
                !manualOfflineRef.current &&
                (consecutiveFailures > 0 || pendingWritesRef.current > 0);
            const delay = degraded ? HEARTBEAT_FAST_RETRY_MS : HEARTBEAT_INTERVAL_MS;
            timer = window.setTimeout(() => {
                void tick();
            }, delay);
        };

        const tick = async () => {
            if (cancelled || tickInFlight) return;
            if (!shouldTick()) {
                scheduleNext();
                return;
            }
            tickInFlight = true;
            try {
                // Manual offline is a user-visible contract ("Forced — no
                // network calls" in the manage UI). Skip the ping and leave
                // the kernel-derived networkOnline alone so the loop doesn't
                // generate traffic while the user has explicitly opted out.
                if (manualOfflineRef.current) {
                    consecutiveFailures = 0;
                } else if (navigator.onLine) {
                    const ok = await pingHealth();
                    if (cancelled) return;
                    setNetworkOnline(ok);
                    if (ok) {
                        consecutiveFailures = 0;
                        // Server is reachable; if we have queued writes, retry
                        // the drain. flushOutbox is singleton-guarded so this
                        // is cheap even if a flush is already running.
                        if (pendingWritesRef.current > 0) {
                            void triggerFlushRef.current();
                        }
                    } else {
                        consecutiveFailures += 1;
                    }
                } else {
                    // Kernel says offline. Don't burn a request; just update
                    // state so the pill reflects reality immediately.
                    setNetworkOnline(false);
                }
            } finally {
                tickInFlight = false;
                scheduleNext();
            }
        };

        const onVisibilityChange = () => {
            if (!cancelled && shouldTick()) void tick();
        };
        const onFocus = () => {
            if (!cancelled) void tick();
        };

        void tick();
        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", onVisibilityChange);
        }
        window.addEventListener("focus", onFocus);

        return () => {
            cancelled = true;
            if (timer !== null) window.clearTimeout(timer);
            if (typeof document !== "undefined") {
                document.removeEventListener("visibilitychange", onVisibilityChange);
            }
            window.removeEventListener("focus", onFocus);
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
    // Keep the heartbeat loop's ref pointed at the latest triggerFlush.
    // Done in an effect so we don't write refs during render; triggerFlush is
    // stable (empty deps) so this runs exactly once.
    useEffect(() => {
        triggerFlushRef.current = triggerFlush;
    }, [triggerFlush]);

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
