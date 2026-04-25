"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck, Trash2, RotateCcw, Download, FileSearch, CloudOff, UploadCloud } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { useOfflineMode } from "@/lib/offline/offline-mode-context";
import {
    applyPendingServiceWorkerUpdate,
    checkForServiceWorkerUpdate,
    clearServiceWorkerCaches,
    getServiceWorkerInfo,
    rewarmAppShell,
    sampleCacheContents,
    type CacheSample,
    type RewarmProgress,
    type ServiceWorkerInfo,
} from "@/lib/offline/service-worker-info";

const ROLE_LABELS: Record<string, string> = {
    nav: "HTML shells",
    media: "Page images",
    api: "Chapter / series APIs",
    static: "CSS / JS bundles",
    unknown: "Other",
};

const CONTROLLER_LABELS: Record<ServiceWorkerInfo["controllerState"], string> = {
    "controlling": "Active and controlling this tab",
    "installed-not-controlling": "Installed, reload to take control",
    "none": "Not registered on this device",
};

type Busy = "rewarm" | "clear" | "update" | "diagnose" | null;

export function ServiceWorkerSection() {
    const offline = useOfflineMode();
    const [info, setInfo] = useState<ServiceWorkerInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<Busy>(null);
    const [rewarmProgress, setRewarmProgress] = useState<RewarmProgress | null>(null);
    const [samples, setSamples] = useState<CacheSample[] | null>(null);
    const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const refresh = useCallback(async () => {
        setLoading(true);
        const next = await getServiceWorkerInfo();
        if (!mountedRef.current) return;
        setInfo(next);
        setLoading(false);
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const handleRewarm = useCallback(async () => {
        setBusy("rewarm");
        setMessage(null);
        setRewarmProgress(null);
        try {
            const final = await rewarmAppShell((progress) => {
                if (mountedRef.current) setRewarmProgress(progress);
            });
            const failed = final.failedHtml + final.failedAssets + final.failedData;
            setMessage(
                failed > 0
                    ? {
                        kind: "error",
                        text: `Cached ${final.cachedHtml} HTML + ${final.cachedAssets} assets + ${final.cachedData} APIs. ${failed} failed — check connection.`,
                    }
                    : {
                        kind: "ok",
                        text: `Cached ${final.cachedHtml} HTML + ${final.cachedAssets} assets + ${final.cachedData} APIs. Offline should work now.`,
                    },
            );
        } catch (error) {
            setMessage({
                kind: "error",
                text: error instanceof Error ? error.message : "Re-fetch failed.",
            });
        } finally {
            if (mountedRef.current) {
                setRewarmProgress(null);
                setBusy(null);
                void refresh();
            }
        }
    }, [refresh]);

    const handleDiagnose = useCallback(async () => {
        setBusy("diagnose");
        setMessage(null);
        try {
            const result = await sampleCacheContents();
            if (mountedRef.current) setSamples(result);
        } catch (error) {
            setMessage({
                kind: "error",
                text: error instanceof Error ? error.message : "Diagnose failed.",
            });
        } finally {
            if (mountedRef.current) setBusy(null);
        }
    }, []);

    const handleClear = useCallback(async () => {
        if (typeof window !== "undefined") {
            const ok = window.confirm(
                "Clear all offline caches? You'll lose pinned chapters, cached library, and offline assets until you re-open the app online.",
            );
            if (!ok) return;
        }
        setBusy("clear");
        setMessage(null);
        try {
            const ok = await clearServiceWorkerCaches();
            setMessage(
                ok
                    ? { kind: "ok", text: "Offline caches cleared." }
                    : { kind: "error", text: "No active service worker responded. Reload and try again." },
            );
        } catch (error) {
            setMessage({
                kind: "error",
                text: error instanceof Error ? error.message : "Clear failed.",
            });
        } finally {
            if (mountedRef.current) {
                setBusy(null);
                void refresh();
            }
        }
    }, [refresh]);

    const handleCheckUpdate = useCallback(async () => {
        setBusy("update");
        setMessage(null);
        try {
            const hasWaiting = await checkForServiceWorkerUpdate();
            if (hasWaiting) {
                await applyPendingServiceWorkerUpdate();
                // applyPendingServiceWorkerUpdate reloads the window, so code
                // after this point usually doesn't run. Keep the message as a
                // fallback in case reload is blocked.
                setMessage({ kind: "ok", text: "New worker activated. Reloading…" });
            } else {
                setMessage({ kind: "ok", text: "Already on the latest service worker." });
            }
        } catch (error) {
            setMessage({
                kind: "error",
                text: error instanceof Error ? error.message : "Update check failed.",
            });
        } finally {
            if (mountedRef.current) {
                setBusy(null);
                void refresh();
            }
        }
    }, [refresh]);

    return (
        <section className="rounded-sm border border-border-subtle bg-surface p-5">
            <div className="mb-4">
                <h2 className="font-display text-lg text-text">Service Worker</h2>
                <p className="mt-0.5 text-xs text-text-faint">
                    The background worker that keeps the reader usable when your server or network is unreachable.
                </p>
            </div>

            {loading && !info ? (
                <div className="flex items-center gap-2 text-xs text-text-faint">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                    Inspecting service worker…
                </div>
            ) : !info ? (
                <p className="text-xs text-text-faint">Service worker details unavailable.</p>
            ) : (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <button
                            type="button"
                            onClick={() => offline.setManualOffline(!offline.manualOffline)}
                            className={cn(
                                "flex w-full items-center justify-between rounded-sm border px-3 py-2.5 text-sm transition-colors",
                                offline.manualOffline
                                    ? "border-accent/30 bg-accent/5 text-text"
                                    : "border-border bg-surface-raised text-text-muted",
                            )}
                        >
                            <span className="flex items-center gap-2">
                                <CloudOff className="h-3.5 w-3.5" />
                                Offline mode
                                <span className="text-xs text-text-faint">
                                    {offline.manualOffline
                                        ? "Forced — no network calls"
                                        : offline.networkOnline
                                            ? "Auto"
                                            : "Detected offline"}
                                </span>
                            </span>
                            <span
                                className={cn(
                                    "rounded-sm px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                                    offline.manualOffline
                                        ? "bg-accent/15 text-accent"
                                        : "bg-surface text-text-faint",
                                )}
                            >
                                {offline.manualOffline ? "On" : "Off"}
                            </span>
                        </button>
                        {offline.pendingWrites > 0 && (
                            <button
                                type="button"
                                onClick={() => void offline.triggerFlush()}
                                disabled={offline.isOffline || offline.flushing}
                                className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                            >
                                <UploadCloud className={cn("h-3 w-3", offline.flushing && "animate-pulse")} />
                                {offline.flushing
                                    ? "Syncing…"
                                    : offline.isOffline
                                        ? `${offline.pendingWrites} progress saves queued — will sync when online`
                                        : `Sync ${offline.pendingWrites} pending now`}
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <div className="rounded-sm bg-surface-raised px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Version</p>
                            <p className="mt-0.5 font-mono text-sm text-text">{info.version ?? "unknown"}</p>
                        </div>
                        <div className="rounded-sm bg-surface-raised px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">State</p>
                            <p className="mt-0.5 text-sm text-text">{CONTROLLER_LABELS[info.controllerState]}</p>
                        </div>
                        <div className="rounded-sm bg-surface-raised px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Cache total</p>
                            <p className="mt-0.5 text-sm text-text">
                                {info.totalBytes === null ? "large — count only" : formatBytes(info.totalBytes)}
                            </p>
                        </div>
                        <div className="rounded-sm bg-surface-raised px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Browser storage</p>
                            <p className="mt-0.5 text-sm text-text">
                                {info.storage
                                    ? `${formatBytes(info.storage.usage)} / ${formatBytes(info.storage.quota)}`
                                    : "unknown"}
                            </p>
                        </div>
                    </div>

                    {info.buckets.length > 0 && (
                        <div className="space-y-1.5 border-t border-border-subtle pt-3">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Cache buckets</p>
                            <div className="space-y-1">
                                {info.buckets.map((bucket) => (
                                    <div
                                        key={bucket.name}
                                        className="flex items-center gap-2 text-xs"
                                    >
                                        <span className="text-text-muted">{ROLE_LABELS[bucket.role] ?? bucket.role}</span>
                                        <span className="font-mono text-[10px] text-text-faint">{bucket.name}</span>
                                        <span className="ml-auto font-mono text-[10px] text-text-faint">
                                            {bucket.entries} entries
                                        </span>
                                        <span className="font-mono text-[10px] text-text-faint">
                                            {bucket.bytes === null ? "—" : formatBytes(bucket.bytes)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {info.updateAvailable && (
                        <div className="flex items-start gap-2 rounded-sm border border-accent/40 bg-accent/5 px-3 py-2 text-xs text-text">
                            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 text-accent" />
                            <div className="flex-1">
                                A newer service worker is waiting. Click <span className="font-semibold">Check for update</span> to activate it.
                            </div>
                        </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void handleRewarm()}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                        >
                            <RotateCcw className={cn("h-3 w-3", busy === "rewarm" && "animate-spin")} />
                            {busy === "rewarm"
                                ? rewarmProgress
                                    ? describeProgress(rewarmProgress)
                                    : "Re-fetching…"
                                : "Re-fetch HTML/CSS/JS"}
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleCheckUpdate()}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                        >
                            <Download className={cn("h-3 w-3", busy === "update" && "animate-pulse")} />
                            {busy === "update" ? "Checking…" : "Check for update"}
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleDiagnose()}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                        >
                            <FileSearch className={cn("h-3 w-3", busy === "diagnose" && "animate-pulse")} />
                            {busy === "diagnose" ? "Sampling…" : "Show cache details"}
                        </button>
                        <button
                            type="button"
                            onClick={() => void refresh()}
                            disabled={busy !== null || loading}
                            className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                        >
                            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
                            Refresh
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleClear()}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                        >
                            <Trash2 className={cn("h-3 w-3", busy === "clear" && "animate-pulse")} />
                            {busy === "clear" ? "Clearing…" : "Clear all caches"}
                        </button>
                    </div>

                    {rewarmProgress && busy === "rewarm" && (
                        <div className="rounded-sm border border-border-subtle bg-surface-raised px-3 py-2 text-[11px] text-text-muted">
                            <div className="font-mono">{describeProgress(rewarmProgress)}</div>
                            <div className="mt-1 font-mono text-text-faint">
                                HTML {rewarmProgress.cachedHtml}/{rewarmProgress.htmlCount} •
                                {" "}assets {rewarmProgress.cachedAssets}/{rewarmProgress.assetCount} •
                                {" "}APIs {rewarmProgress.cachedData}/{rewarmProgress.dataCount}
                                {(rewarmProgress.failedHtml || rewarmProgress.failedAssets || rewarmProgress.failedData) ? (
                                    <span className="text-red-400">
                                        {" "}• failed html {rewarmProgress.failedHtml} assets {rewarmProgress.failedAssets} data {rewarmProgress.failedData}
                                    </span>
                                ) : null}
                            </div>
                        </div>
                    )}

                    {samples && samples.length > 0 && (
                        <div className="space-y-2 border-t border-border-subtle pt-3">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Cache contents (first 10 per bucket)</p>
                            {samples.map((bucket) => (
                                <div key={bucket.name} className="rounded-sm border border-border-subtle bg-surface-raised px-3 py-2 text-[11px]">
                                    <div className="flex items-center gap-2">
                                        <span className="text-text-muted">{bucket.role}</span>
                                        <span className="font-mono text-text-faint">{bucket.name}</span>
                                        <span className="ml-auto font-mono text-text-faint">{bucket.totalEntries} entries</span>
                                    </div>
                                    {bucket.sample.length > 0 ? (
                                        <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-text-faint">
                                            {bucket.sample.map((url) => (
                                                <li key={url} className="truncate">{url}</li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="mt-1 text-[10px] text-text-faint">empty</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {message && (
                        <p
                            className={cn(
                                "text-xs",
                                message.kind === "ok" ? "text-accent" : "text-red-400",
                            )}
                        >
                            {message.text}
                        </p>
                    )}
                </div>
            )}
        </section>
    );
}

function describeProgress(p: RewarmProgress): string {
    switch (p.phase) {
        case "fetching-html":
            return p.current ? `Fetching ${p.current}…` : "Fetching pages…";
        case "parsing-assets":
            return p.current ? `Scanning ${p.current}…` : "Scanning for assets…";
        case "precaching-html":
            return "Caching HTML shells…";
        case "precaching-assets":
            return "Caching CSS/JS/fonts…";
        case "precaching-data":
            return p.current ? `Caching ${p.current}…` : "Caching library data…";
        case "done":
            return "Done";
        default:
            return "Re-fetching…";
    }
}
