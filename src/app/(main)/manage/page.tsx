"use client";

import { useEffect, useRef, useState } from "react";
import { useNsfw } from "@/lib/nsfw-context";
import {
    buildHostSwitchUrl,
    isPrivateHost,
    isPublicHost,
    PRIVATE_APP_HOSTNAME,
    PUBLIC_APP_HOSTNAME,
} from "@/lib/network/client";
import {
    ExternalLink,
    Loader2,
    Pencil,
    Plus,
    Trash2,
    Check,
    X,
    Link2,
    Link2Off,
    RefreshCw,
    Download,
    HardDriveDownload,
    Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { InputField } from "@/components/ui/input";
import { SelectDropdown } from "@/components/ui/select";


type TagType = "mood" | "genre" | "theme" | "custom";

interface TagRecord {
    id: string;
    name: string;
    color: string | null;
    type: TagType;
    seriesCount: number;
}

interface AniListOverview {
    configured: boolean;
    connected: boolean;
    viewerName: string | null;
    expiresAt: string | null;
    lastSyncAt: string | null;
    linkedSeriesCount: number;
    recentLogs: Array<{
        id: string;
        direction: "import" | "push" | "pull" | "merge";
        status: "success" | "error" | "conflict";
        details: string;
        createdAt: string | null;
    }>;
}

interface OfflineOverview {
    storage: {
        cacheBytes: number;
        cachedFiles: number;
        pinnedBytes: number;
        pinnedChapters: number;
    };
    chapters: Array<{
        sourceSeriesId: string;
        sourceChapterId: string;
        title: string;
        chapterNo: number;
        bytes: number;
        pinned: boolean;
    }>;
}

interface MemoryOverview {
    timeline: Array<{
        id: string;
        type: string;
        createdAt: string | null;
        sourceSeriesId: string | null;
        sourceChapterId: string | null;
        seriesTitle: string | null;
        chapterTitle: string | null;
        payload: unknown;
    }>;
    stats: {
        completedChaptersTotal: number;
        completedChaptersLast30Days: number;
        chaptersPerDayLast30Days: number;
        activeDaysLast30Days: number;
        currentStreakDays: number;
        bestStreakDays: number;
        monthlySummaries: Array<{
            month: string;
            completedChapters: number;
        }>;
    };
}

interface BackgroundSettings {
    downloadConcurrency: number;
    downloadConcurrencyFallback: number;
    nextNAfterRead: number;
    autoDeleteReadEnabled: boolean;
    autoDeleteKeepLastN: number;
    defaultNewChapterLimit: number;
    failureThreshold: number;
    fallbackCooldownMinutes: number;
    fallbackUntil: string | null;
}

interface NetworkPathStatus {
    route: "tailscale" | "cloudflare" | "direct";
    host: string | null;
    scheme: string | null;
}

type BackgroundNumericSettingKey =
    | "downloadConcurrency"
    | "downloadConcurrencyFallback"
    | "failureThreshold"
    | "nextNAfterRead"
    | "autoDeleteKeepLastN"
    | "defaultNewChapterLimit";

type BackgroundNumericDrafts = Record<BackgroundNumericSettingKey, string>;

const TAG_TYPE_OPTIONS: Array<{ value: TagType; label: string }> = [
    { value: "custom", label: "Custom" },
    { value: "mood", label: "Mood" },
    { value: "genre", label: "Genre" },
    { value: "theme", label: "Theme" },
];

const TAG_PRESETS = [
    "#c94a3a", "#d97706", "#52a560", "#4889c4",
    "#7568b0", "#b068a6", "#b89038", "#6e7291",
];


function SectionCard({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <section
            className={cn(
                "rounded-sm border border-border-subtle bg-surface p-5",
                className,
            )}
        >
            {children}
        </section>
    );
}

function SectionHeader({
    title,
    description,
}: {
    title: string;
    description?: string;
}) {
    return (
        <div className="mb-4">
            <h2 className="font-display text-lg text-text">{title}</h2>
            {description && (
                <p className="mt-0.5 text-xs text-text-faint">{description}</p>
            )}
        </div>
    );
}


type ReadingDirection = "vertical" | "ltr" | "rtl";
type FitMode = "width" | "height" | "original";

const DIRECTION_OPTIONS: Array<{ value: ReadingDirection; label: string }> = [
    { value: "vertical", label: "Vertical Scroll" },
    { value: "ltr", label: "Left to Right" },
    { value: "rtl", label: "Right to Left" },
];

const FIT_MODE_OPTIONS: Array<{ value: FitMode; label: string }> = [
    { value: "width", label: "Width" },
    { value: "height", label: "Height" },
    { value: "original", label: "Original" },
];

const PRELOAD_OPTIONS = [0, 3, 5, 8, 12];
const AUTOSCROLL_SPEED_OPTIONS = [30, 50, 70, 90, 120, 160, 220, 300, 400, 500];

const PRELOAD_STORAGE_KEY = "reader:preload-window";
const PROGRESS_BAR_KEY = "reader:show-progress-bar";
const DIRECTION_KEY = "reader:default-direction";
const FIT_MODE_KEY = "reader:default-fit-mode";
const AUTOSCROLL_SPEED_KEY = "reader:autoscroll-speed";

function normalizeAutoscrollSpeed(value: number) {
    if (!Number.isFinite(value)) return 70;
    return Math.min(Math.max(Math.round(value), 20), 500);
}

export default function ManagePage() {
    const [tags, setTags] = useState<TagRecord[]>([]);
    const [aniList, setAniList] = useState<AniListOverview | null>(null);
    const [offline, setOffline] = useState<OfflineOverview | null>(null);
    const [memory, setMemory] = useState<MemoryOverview | null>(null);
    const [backgroundSettings, setBackgroundSettings] = useState<BackgroundSettings | null>(null);
    const [networkPath, setNetworkPath] = useState<NetworkPathStatus | null>(null);
    const [loadedSections, setLoadedSections] = useState({
        tags: false,
        aniList: false,
        offline: false,
        memory: false,
        background: false,
        network: false,
    });
    const [currentHostname, setCurrentHostname] = useState<string | null>(null);
    const [backgroundDrafts, setBackgroundDrafts] = useState<BackgroundNumericDrafts>({
        downloadConcurrency: "4",
        downloadConcurrencyFallback: "2",
        failureThreshold: "8",
        nextNAfterRead: "10",
        autoDeleteKeepLastN: "5",
        defaultNewChapterLimit: "3",
    });

    // Reader preferences
    const [readerDirection, setReaderDirection] = useState<ReadingDirection>("vertical");
    const [readerFitMode, setReaderFitMode] = useState<FitMode>("width");
    const [readerProgressBar, setReaderProgressBar] = useState(true);
    const [readerPreload, setReaderPreload] = useState(5);
    const [readerAutoscrollSpeed, setReaderAutoscrollSpeed] = useState(70);


    // Tag form
    const [tagName, setTagName] = useState("");
    const [tagColor, setTagColor] = useState("#c94a3a");
    const [tagType, setTagType] = useState<TagType>("custom");
    const [savingTag, setSavingTag] = useState(false);
    const [editTagId, setEditTagId] = useState<string | null>(null);
    const [editTagName, setEditTagName] = useState("");
    const [editTagColor, setEditTagColor] = useState("#c94a3a");
    const [editTagType, setEditTagType] = useState<TagType>("custom");

    // NSFW
    const { nsfwEnabled, setNsfwEnabled } = useNsfw();
    const [showNsfwSection, setShowNsfwSection] = useState(false);
    const nsfwTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // AniList
    const [aniListBusy, setAniListBusy] = useState<string | null>(null);
    const [offlineBusy, setOfflineBusy] = useState<string | null>(null);
    const [settingsBusy, setSettingsBusy] = useState(false);

    function formatBytes(bytes: number) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    useEffect(() => {
        let cancelled = false;

        setLoadedSections({
            tags: false,
            aniList: false,
            offline: false,
            memory: false,
            background: false,
            network: false,
        });

        async function loadSection<T>(key: keyof typeof loadedSections, task: () => Promise<T>, onSuccess: (value: T) => void, onFailure: () => void) {
            try {
                const value = await task();
                if (!cancelled) {
                    onSuccess(value);
                }
            } catch {
                if (!cancelled) {
                    onFailure();
                }
            } finally {
                if (!cancelled) {
                    setLoadedSections((current) => ({ ...current, [key]: true }));
                }
            }
        }

        const nsfwParam = nsfwEnabled ? "?nsfw=1" : "";

        void loadSection(
            "tags",
            async () => {
                const res = await fetch("/api/tags");
                return res.ok ? ((await res.json()) as TagRecord[]) : [];
            },
            (value) => setTags(value),
            () => setTags([]),
        );

        void loadSection(
            "aniList",
            async () => {
                const res = await fetch("/api/anilist/status");
                return res.ok ? ((await res.json()) as AniListOverview) : null;
            },
            (value) => setAniList(value),
            () => setAniList(null),
        );

        void loadSection(
            "offline",
            async () => {
                const res = await fetch("/api/offline");
                return res.ok ? ((await res.json()) as OfflineOverview) : null;
            },
            (value) => setOffline(value),
            () => setOffline(null),
        );

        void loadSection(
            "memory",
            async () => {
                const res = await fetch(`/api/memory/overview${nsfwParam}`);
                return res.ok ? ((await res.json()) as MemoryOverview) : null;
            },
            (value) => setMemory(value),
            () => setMemory(null),
        );

        void loadSection(
            "background",
            async () => {
                const res = await fetch("/api/background/settings");
                return res.ok
                    ? ((await res.json()) as { settings: BackgroundSettings }).settings
                    : null;
            },
            (value) => setBackgroundSettings(value),
            () => setBackgroundSettings(null),
        );

        void loadSection(
            "network",
            async () => {
                const res = await fetch("/api/network/path");
                return res.ok ? ((await res.json()) as NetworkPathStatus) : null;
            },
            (value) => setNetworkPath(value),
            () => setNetworkPath(null),
        );

        return () => {
            cancelled = true;
        };
    }, [nsfwEnabled]);

    // Load reader preferences from localStorage
    useEffect(() => {
        const progressBar = window.localStorage.getItem(PROGRESS_BAR_KEY);
        if (progressBar === "0") setReaderProgressBar(false);
        if (progressBar === "1") setReaderProgressBar(true);

        const preload = window.localStorage.getItem(PRELOAD_STORAGE_KEY);
        const parsed = preload ? Number.parseInt(preload, 10) : Number.NaN;
        if (Number.isFinite(parsed) && parsed >= 0) setReaderPreload(parsed);

        const direction = window.localStorage.getItem(DIRECTION_KEY) as ReadingDirection | null;
        if (direction === "vertical" || direction === "ltr" || direction === "rtl") setReaderDirection(direction);

        const fitMode = window.localStorage.getItem(FIT_MODE_KEY) as FitMode | null;
        if (fitMode === "width" || fitMode === "height" || fitMode === "original") setReaderFitMode(fitMode);

        const autoscrollSpeed = window.localStorage.getItem(AUTOSCROLL_SPEED_KEY);
        const parsedSpeed = autoscrollSpeed ? Number.parseFloat(autoscrollSpeed) : Number.NaN;
        if (Number.isFinite(parsedSpeed)) setReaderAutoscrollSpeed(normalizeAutoscrollSpeed(parsedSpeed));

        setCurrentHostname(window.location.hostname);
    }, []);

    useEffect(() => {
        if (!backgroundSettings) return;
        setBackgroundDrafts({
            downloadConcurrency: String(backgroundSettings.downloadConcurrency),
            downloadConcurrencyFallback: String(backgroundSettings.downloadConcurrencyFallback),
            failureThreshold: String(backgroundSettings.failureThreshold),
            nextNAfterRead: String(backgroundSettings.nextNAfterRead),
            autoDeleteKeepLastN: String(backgroundSettings.autoDeleteKeepLastN),
            defaultNewChapterLimit: String(backgroundSettings.defaultNewChapterLimit),
        });
    }, [backgroundSettings]);

    function handleReaderDirectionChange(value: ReadingDirection) {
        setReaderDirection(value);
        window.localStorage.setItem(DIRECTION_KEY, value);
    }

    function handleReaderFitModeChange(value: FitMode) {
        setReaderFitMode(value);
        window.localStorage.setItem(FIT_MODE_KEY, value);
    }

    function handleReaderProgressBarChange(enabled: boolean) {
        setReaderProgressBar(enabled);
        window.localStorage.setItem(PROGRESS_BAR_KEY, enabled ? "1" : "0");
    }

    function handleReaderPreloadChange(value: number) {
        setReaderPreload(value);
        window.localStorage.setItem(PRELOAD_STORAGE_KEY, String(value));
    }

    function handleReaderAutoscrollSpeedChange(value: number) {
        const next = normalizeAutoscrollSpeed(value);
        setReaderAutoscrollSpeed(next);
        window.localStorage.setItem(AUTOSCROLL_SPEED_KEY, String(next));
    }

    function switchToHost(hostname: string) {
        window.location.assign(buildHostSwitchUrl(window.location.href, hostname));
    }

    async function refreshOffline() {
        const res = await fetch("/api/offline");
        if (res.ok) {
            setOffline(await res.json());
        }
    }


    async function refreshAniList() {
        const res = await fetch("/api/anilist/status");
        if (res.ok) setAniList(await res.json());
    }

    async function handleAniListAction(action: "import" | "sync" | "disconnect") {
        setAniListBusy(action);
        try {
            const res = await fetch(
                action === "disconnect" ? "/api/anilist/status" : `/api/anilist/${action}`,
                { method: action === "disconnect" ? "DELETE" : "POST" },
            );
            if (res.ok) await refreshAniList();
        } finally {
            setAniListBusy(null);
        }
    }

    async function handleRefreshManifests() {
        setOfflineBusy("refreshManifests");
        try {
            const res = await fetch("/api/offline", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "refreshManifests" }),
            });
            if (res.ok) {
                await refreshOffline();
            }
        } finally {
            setOfflineBusy(null);
        }
    }

    async function handleOfflineCleanup() {
        setOfflineBusy("cleanup");
        try {
            const res = await fetch("/api/offline", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "cleanup" }),
            });
            if (res.ok) {
                await refreshOffline();
            }
        } finally {
            setOfflineBusy(null);
        }
    }

    async function handleOptimizeCache() {
        setOfflineBusy("optimizeCache");
        try {
            const res = await fetch("/api/offline", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "optimizeCache" }),
            });
            if (res.ok) {
                await refreshOffline();
            }
        } finally {
            setOfflineBusy(null);
        }
    }

    async function saveBackgroundSettings(partial: Partial<BackgroundSettings>) {
        if (!backgroundSettings) return;
        setSettingsBusy(true);
        const optimistic = { ...backgroundSettings, ...partial };
        setBackgroundSettings(optimistic);

        try {
            const res = await fetch("/api/background/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(partial),
            });
            if (res.ok) {
                const body = (await res.json()) as { settings: BackgroundSettings };
                setBackgroundSettings(body.settings);
            } else {
                setBackgroundSettings(backgroundSettings);
            }
        } finally {
            setSettingsBusy(false);
        }
    }

    function updateBackgroundDraft<K extends BackgroundNumericSettingKey>(key: K, value: string) {
        setBackgroundDrafts((current) => ({ ...current, [key]: value }));
    }

    function commitBackgroundNumberSetting(key: BackgroundNumericSettingKey) {
        if (!backgroundSettings) return;
        const raw = backgroundDrafts[key].trim();
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isFinite(parsed)) {
            setBackgroundDrafts((current) => ({
                ...current,
                [key]: String(backgroundSettings[key]),
            }));
            return;
        }
        void saveBackgroundSettings({ [key]: parsed } as Partial<BackgroundSettings>);
    }

    function handleBackgroundNumberKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Enter") {
            event.currentTarget.blur();
        }
    }




    async function handleCreateTag(e: React.FormEvent) {
        e.preventDefault();
        if (!tagName.trim()) return;
        setSavingTag(true);
        try {
            const res = await fetch("/api/tags", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: tagName, color: tagColor, type: tagType }),
            });
            if (res.ok) {
                const next = (await res.json()) as TagRecord;
                setTags((t) => [...t, next].sort((a, b) => a.name.localeCompare(b.name)));
                setTagName("");
                setTagColor("#c94a3a");
                setTagType("custom");
            }
        } finally {
            setSavingTag(false);
        }
    }

    async function handleUpdateTag(id: string) {
        if (!editTagName.trim()) return;
        setSavingTag(true);
        try {
            const res = await fetch(`/api/tags/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: editTagName, color: editTagColor, type: editTagType }),
            });
            if (res.ok) {
                const next = (await res.json()) as TagRecord;
                setTags((t) => t.map((x) => (x.id === id ? next : x)));
                setEditTagId(null);
            }
        } finally {
            setSavingTag(false);
        }
    }

    async function handleDeleteTag(id: string) {
        setSavingTag(true);
        try {
            const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
            if (res.ok) setTags((t) => t.filter((x) => x.id !== id));
        } finally {
            setSavingTag(false);
        }
    }
    return (
        <div className="space-y-6 pb-20">
            <div>
                <h1
                    className="select-none cursor-default font-display text-3xl leading-none text-text"
                    onPointerDown={() => {
                        nsfwTimerRef.current = setTimeout(() => {
                            setShowNsfwSection(true);
                        }, 3000);
                    }}
                    onPointerUp={() => {
                        if (nsfwTimerRef.current) { clearTimeout(nsfwTimerRef.current); nsfwTimerRef.current = null; }
                    }}
                    onPointerLeave={() => {
                        if (nsfwTimerRef.current) { clearTimeout(nsfwTimerRef.current); nsfwTimerRef.current = null; }
                    }}
                >
                    Manage
                </h1>
                <p className="mt-1 text-xs text-text-faint">
                    Organize your library with tags and connected services.
                </p>
            </div>

            <SectionCard>
                <SectionHeader
                    title="Connection"
                    description="Shows whether this session reached the app over Tailscale or Cloudflare."
                />

                {loadedSections.network ? (
                    networkPath ? (
                    <div className="space-y-3">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Route</p>
                                <p className="mt-0.5 text-sm text-text">
                                    {networkPath.route === "tailscale"
                                        ? "Tailscale"
                                        : networkPath.route === "cloudflare"
                                            ? "Cloudflare"
                                            : "Direct"}
                                </p>
                            </div>
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Host</p>
                                <p className="mt-0.5 truncate text-sm text-text">{networkPath.host ?? "Unknown"}</p>
                            </div>
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Scheme</p>
                                <p className="mt-0.5 text-sm text-text">{networkPath.scheme ?? "Unknown"}</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {currentHostname && !isPrivateHost(currentHostname) && (
                                <button
                                    type="button"
                                    onClick={() => switchToHost(PRIVATE_APP_HOSTNAME)}
                                    disabled={networkPath.route === "tailscale"}
                                    className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    Switch to {PRIVATE_APP_HOSTNAME}
                                </button>
                            )}
                            {currentHostname && !isPublicHost(currentHostname) && (
                                <button
                                    type="button"
                                    onClick={() => switchToHost(PUBLIC_APP_HOSTNAME)}
                                    className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent"
                                >
                                    Switch to {PUBLIC_APP_HOSTNAME}
                                </button>
                            )}
                        </div>

                        <p className="text-xs text-text-faint">
                            The private host is <span className="font-mono">{PRIVATE_APP_HOSTNAME}</span>. On iPhone/iPad,
                            cross-host switching from an installed PWA may reopen in Safari because it is a different origin.
                        </p>
                    </div>
                    ) : (
                    <p className="text-xs text-text-faint">Connection status unavailable.</p>
                    )
                ) : (
                    <div className="flex items-center gap-2 text-xs text-text-faint">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                        Loading connection status…
                    </div>
                )}
            </SectionCard>

            {(showNsfwSection || nsfwEnabled) && (
                <SectionCard>
                    <SectionHeader
                        title="Content Filter"
                        description="Session-only. Resets when you close the tab."
                    />
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setNsfwEnabled(!nsfwEnabled)}
                            className={cn(
                                "relative h-5 w-9 rounded-full transition-colors duration-200",
                                nsfwEnabled ? "bg-accent" : "bg-border",
                            )}
                        >
                            <span
                                className={cn(
                                    "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-200",
                                    nsfwEnabled && "translate-x-4",
                                )}
                            />
                        </button>
                        <span className="text-sm text-text">Show adult content</span>
                    </div>
                </SectionCard>
            )}

            <SectionCard>
                <SectionHeader title="Reader" description="Default reading preferences for the chapter viewer." />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                        <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.14em] text-text-faint">
                            Reading direction
                        </label>
                        <SelectDropdown
                            value={readerDirection}
                            onChange={(e) => handleReaderDirectionChange(e.target.value as ReadingDirection)}
                        >
                            {DIRECTION_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </SelectDropdown>
                    </div>

                    <div>
                        <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.14em] text-text-faint">
                            Fit mode
                        </label>
                        <SelectDropdown
                            value={readerFitMode}
                            onChange={(e) => handleReaderFitModeChange(e.target.value as FitMode)}
                        >
                            {FIT_MODE_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </SelectDropdown>
                    </div>

                    <div>
                        <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.14em] text-text-faint">
                            Preload window
                        </label>
                        <SelectDropdown
                            value={String(readerPreload)}
                            onChange={(e) => handleReaderPreloadChange(Number.parseInt(e.target.value, 10))}
                        >
                            {PRELOAD_OPTIONS.map((v) => (
                                <option key={v} value={v}>{v === 0 ? "Off" : `${v} pages`}</option>
                            ))}
                        </SelectDropdown>
                    </div>

                    <div>
                        <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.14em] text-text-faint">
                            Autoscroll speed
                        </label>
                        <SelectDropdown
                            value={String(readerAutoscrollSpeed)}
                            onChange={(e) => handleReaderAutoscrollSpeedChange(Number.parseInt(e.target.value, 10))}
                        >
                            {AUTOSCROLL_SPEED_OPTIONS.map((v) => (
                                <option key={v} value={v}>{v} px/s</option>
                            ))}
                        </SelectDropdown>
                    </div>

                    <div className="flex items-end">
                        <button
                            type="button"
                            onClick={() => handleReaderProgressBarChange(!readerProgressBar)}
                            className={cn(
                                "flex w-full items-center justify-between rounded-sm border px-3 py-2.5 text-sm transition-colors",
                                readerProgressBar
                                    ? "border-accent/30 bg-accent/5 text-text"
                                    : "border-border bg-surface-raised text-text-muted",
                            )}
                        >
                            <span>Progress bar</span>
                            <span className={cn(
                                "rounded-sm px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                                readerProgressBar
                                    ? "bg-accent/15 text-accent"
                                    : "bg-surface text-text-faint",
                            )}>
                                {readerProgressBar ? "On" : "Off"}
                            </span>
                        </button>
                    </div>
                </div>
            </SectionCard>

            <SectionCard>
                <SectionHeader title="AniList" description="Sync reading progress with AniList." />

                {!loadedSections.aniList ? (
                    <div className="flex items-center gap-2 text-xs text-text-faint">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                        Loading AniList status…
                    </div>
                ) : aniList?.connected ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 rounded-sm bg-surface-raised px-3.5 py-2.5">
                            <span className="relative flex h-2 w-2">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-completed opacity-60" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-completed" />
                            </span>
                            <span className="text-sm text-text">
                                {aniList.viewerName}
                            </span>
                            <span className="font-mono text-[10px] text-text-faint">
                                {aniList.linkedSeriesCount} linked
                            </span>
                            {aniList.lastSyncAt && (
                                <>
                                    <span className="text-border">·</span>
                                    <span className="font-mono text-[10px] text-text-faint">
                                        synced {new Date(aniList.lastSyncAt).toLocaleDateString()}
                                    </span>
                                </>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => void handleAniListAction("import")}
                                disabled={aniListBusy !== null}
                                className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                            >
                                <Download className="h-3 w-3" />
                                {aniListBusy === "import" ? "Importing…" : "Import"}
                            </button>
                            <button
                                onClick={() => void handleAniListAction("sync")}
                                disabled={aniListBusy !== null}
                                className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                            >
                                <RefreshCw className={cn("h-3 w-3", aniListBusy === "sync" && "animate-spin")} />
                                {aniListBusy === "sync" ? "Syncing…" : "Sync"}
                            </button>
                            <button
                                onClick={() => void handleAniListAction("disconnect")}
                                disabled={aniListBusy !== null}
                                className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-dropped transition-colors hover:bg-dropped/10 disabled:opacity-50"
                            >
                                <Link2Off className="h-3 w-3" />
                                {aniListBusy === "disconnect" ? "…" : "Disconnect"}
                            </button>
                        </div>

                        {aniList.recentLogs.length > 0 && (
                            <div className="space-y-1.5 border-t border-border-subtle pt-3">
                                <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-text-faint">
                                    Recent activity
                                </p>
                                <div className="space-y-1">
                                    {aniList.recentLogs.slice(0, 5).map((log) => (
                                        <div
                                            key={log.id}
                                            className="flex items-start gap-2 text-xs"
                                        >
                                            <span
                                                className={cn(
                                                    "mt-px shrink-0 font-mono text-[10px] uppercase",
                                                    log.status === "error"
                                                        ? "text-dropped"
                                                        : log.status === "conflict"
                                                            ? "text-paused"
                                                            : "text-completed",
                                                )}
                                            >
                                                {log.direction}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate text-text-faint">
                                                {log.details}
                                            </span>
                                            {log.createdAt && (
                                                <span className="shrink-0 font-mono text-[10px] text-text-faint">
                                                    {new Date(log.createdAt).toLocaleDateString()}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="flex items-center gap-4 rounded-sm bg-surface-raised px-3.5 py-3">
                        <Link2 className="h-4 w-4 shrink-0 text-text-faint" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm text-text-muted">
                                {aniList?.configured
                                    ? "AniList is configured but not connected."
                                    : "AniList integration is not configured."}
                            </p>
                        </div>
                        {aniList?.configured && (
                            <a
                                href="/api/anilist/connect"
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-void transition-colors hover:bg-accent-muted"
                            >
                                <ExternalLink className="h-3 w-3" />
                                Connect
                            </a>
                        )}
                    </div>
                )}
            </SectionCard>

            <SectionCard>
                <SectionHeader
                    title="Offline Cache"
                    description="Manage downloaded chapters and local storage usage."
                />

                {!loadedSections.offline ? (
                    <div className="flex items-center gap-2 text-xs text-text-faint">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                        Loading offline cache details…
                    </div>
                ) : offline ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Cache size</p>
                                <p className="mt-0.5 text-sm text-text">{formatBytes(offline.storage.cacheBytes)}</p>
                            </div>
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Downloaded size</p>
                                <p className="mt-0.5 text-sm text-text">{formatBytes(offline.storage.pinnedBytes)}</p>
                            </div>
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Downloaded chapters</p>
                                <p className="mt-0.5 text-sm text-text">{offline.storage.pinnedChapters}</p>
                            </div>
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Cached files</p>
                                <p className="mt-0.5 text-sm text-text">{offline.storage.cachedFiles}</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => void refreshOffline()}
                                className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent"
                            >
                                <HardDriveDownload className="h-3 w-3" />
                                Refresh
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleRefreshManifests()}
                                disabled={offlineBusy !== null}
                                className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                            >
                                <RefreshCw className={cn("h-3 w-3", offlineBusy === "refreshManifests" && "animate-spin")} />
                                {offlineBusy === "refreshManifests" ? "Queuing…" : "Refresh all manifests"}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleOfflineCleanup()}
                                disabled={offlineBusy !== null}
                                className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                            >
                                <Trash2 className="h-3 w-3" />
                                {offlineBusy === "cleanup" ? "Cleaning…" : "Clean non-downloaded cache"}
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleOptimizeCache()}
                                disabled={offlineBusy !== null}
                                className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                            >
                                <Zap className={cn("h-3 w-3", offlineBusy === "optimizeCache" && "animate-pulse")} />
                                {offlineBusy === "optimizeCache" ? "Optimizing…" : "Optimize cached images"}
                            </button>
                        </div>

                        {offline.chapters.length > 0 && (
                            <div className="space-y-1.5 border-t border-border-subtle pt-3">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Recently downloaded</p>
                                <div className="space-y-1">
                                    {offline.chapters.filter((item) => item.pinned).slice(0, 6).map((item) => (
                                        <div key={`${item.sourceSeriesId}:${item.sourceChapterId}`} className="flex items-center gap-2 text-xs">
                                            <span className="min-w-0 flex-1 truncate text-text-muted">
                                                {item.title}
                                            </span>
                                            <span className="font-mono text-[10px] text-text-faint">
                                                {formatBytes(item.bytes)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="text-xs text-text-faint">Offline storage details unavailable.</p>
                )}
            </SectionCard>

            <SectionCard>
                <SectionHeader
                    title="Background Jobs"
                    description="Global queue, automation, and fallback settings for downloads and updates."
                />

                {!loadedSections.background ? (
                    <div className="flex items-center gap-2 text-xs text-text-faint">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                        Loading background settings…
                    </div>
                ) : backgroundSettings ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Download concurrency</p>
                                <p className="mt-0.5 text-sm text-text">{backgroundSettings.downloadConcurrency}</p>
                            </div>
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Fallback concurrency</p>
                                <p className="mt-0.5 text-sm text-text">{backgroundSettings.downloadConcurrencyFallback}</p>
                            </div>
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Next N after read</p>
                                <p className="mt-0.5 text-sm text-text">{backgroundSettings.nextNAfterRead}</p>
                            </div>
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Default new chapter cap</p>
                                <p className="mt-0.5 text-sm text-text">{backgroundSettings.defaultNewChapterLimit}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            <label className="space-y-1">
                                <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Download concurrency</span>
                                <InputField
                                    value={backgroundDrafts.downloadConcurrency}
                                    onChange={(event) => updateBackgroundDraft("downloadConcurrency", event.target.value)}
                                    onBlur={() => commitBackgroundNumberSetting("downloadConcurrency")}
                                    onKeyDown={handleBackgroundNumberKeyDown}
                                    inputMode="numeric"
                                    disabled={settingsBusy}
                                />
                            </label>

                            <label className="space-y-1">
                                <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Fallback concurrency</span>
                                <InputField
                                    value={backgroundDrafts.downloadConcurrencyFallback}
                                    onChange={(event) => updateBackgroundDraft("downloadConcurrencyFallback", event.target.value)}
                                    onBlur={() => commitBackgroundNumberSetting("downloadConcurrencyFallback")}
                                    onKeyDown={handleBackgroundNumberKeyDown}
                                    inputMode="numeric"
                                    disabled={settingsBusy}
                                />
                            </label>

                            <label className="space-y-1">
                                <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Failure threshold</span>
                                <InputField
                                    value={backgroundDrafts.failureThreshold}
                                    onChange={(event) => updateBackgroundDraft("failureThreshold", event.target.value)}
                                    onBlur={() => commitBackgroundNumberSetting("failureThreshold")}
                                    onKeyDown={handleBackgroundNumberKeyDown}
                                    inputMode="numeric"
                                    disabled={settingsBusy}
                                />
                            </label>

                            <label className="space-y-1">
                                <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Next N after read</span>
                                <InputField
                                    value={backgroundDrafts.nextNAfterRead}
                                    onChange={(event) => updateBackgroundDraft("nextNAfterRead", event.target.value)}
                                    onBlur={() => commitBackgroundNumberSetting("nextNAfterRead")}
                                    onKeyDown={handleBackgroundNumberKeyDown}
                                    inputMode="numeric"
                                    disabled={settingsBusy}
                                />
                            </label>

                            <label className="space-y-1">
                                <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Keep last N read</span>
                                <InputField
                                    value={backgroundDrafts.autoDeleteKeepLastN}
                                    onChange={(event) => updateBackgroundDraft("autoDeleteKeepLastN", event.target.value)}
                                    onBlur={() => commitBackgroundNumberSetting("autoDeleteKeepLastN")}
                                    onKeyDown={handleBackgroundNumberKeyDown}
                                    inputMode="numeric"
                                    disabled={settingsBusy}
                                />
                            </label>

                            <label className="space-y-1">
                                <span className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Default new chapter cap</span>
                                <InputField
                                    value={backgroundDrafts.defaultNewChapterLimit}
                                    onChange={(event) => updateBackgroundDraft("defaultNewChapterLimit", event.target.value)}
                                    onBlur={() => commitBackgroundNumberSetting("defaultNewChapterLimit")}
                                    onKeyDown={handleBackgroundNumberKeyDown}
                                    inputMode="numeric"
                                    disabled={settingsBusy}
                                />
                            </label>
                        </div>

                        <button
                            type="button"
                            onClick={() => void saveBackgroundSettings({
                                autoDeleteReadEnabled: !backgroundSettings.autoDeleteReadEnabled,
                            })}
                            disabled={settingsBusy}
                            className={cn(
                                "inline-flex items-center justify-between rounded-sm border px-3 py-2 text-xs transition-colors disabled:opacity-50",
                                backgroundSettings.autoDeleteReadEnabled
                                    ? "border-accent/30 bg-accent/5 text-text"
                                    : "border-border bg-surface-raised text-text-muted",
                            )}
                        >
                            Auto-delete read downloads
                            <span className={cn(
                                "ml-2 rounded-sm px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                                backgroundSettings.autoDeleteReadEnabled
                                    ? "bg-accent/15 text-accent"
                                    : "bg-surface text-text-faint",
                            )}>
                                {backgroundSettings.autoDeleteReadEnabled ? "On" : "Off"}
                            </span>
                        </button>

                        {backgroundSettings.fallbackUntil && (
                            <p className="text-xs text-paused">
                                Fallback active until {new Date(backgroundSettings.fallbackUntil).toLocaleString()}
                            </p>
                        )}
                    </div>
                ) : (
                    <p className="text-xs text-text-faint">Background settings unavailable.</p>
                )}
            </SectionCard>

            <SectionCard>
                <SectionHeader
                    title="Memory"
                    description="Reading history and personal pace signals from your local activity."
                />

                {!loadedSections.memory ? (
                    <div className="flex items-center gap-2 text-xs text-text-faint">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                        Loading memory overview…
                    </div>
                ) : memory ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Completed total</p>
                                <p className="mt-0.5 text-sm text-text">{memory.stats.completedChaptersTotal}</p>
                            </div>
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Completed (30d)</p>
                                <p className="mt-0.5 text-sm text-text">{memory.stats.completedChaptersLast30Days}</p>
                            </div>
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Avg/day (30d)</p>
                                <p className="mt-0.5 text-sm text-text">{memory.stats.chaptersPerDayLast30Days}</p>
                            </div>
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Active days (30d)</p>
                                <p className="mt-0.5 text-sm text-text">{memory.stats.activeDaysLast30Days}</p>
                            </div>
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Current streak</p>
                                <p className="mt-0.5 text-sm text-text">{memory.stats.currentStreakDays}d</p>
                            </div>
                            <div className="rounded-sm bg-surface-raised px-3 py-2">
                                <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Best streak</p>
                                <p className="mt-0.5 text-sm text-text">{memory.stats.bestStreakDays}d</p>
                            </div>
                        </div>

                        <div className="space-y-1.5 border-t border-border-subtle pt-3">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Recent timeline</p>
                            {memory.timeline.length > 0 ? (
                                <div className="space-y-1">
                                    {memory.timeline.slice(0, 8).map((event) => (
                                        <div key={event.id} className="flex items-center gap-2 text-xs">
                                            <span className="shrink-0 font-mono text-[10px] uppercase text-text-faint">
                                                {event.type.replaceAll("_", " ")}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate text-text-muted">
                                                {event.seriesTitle ?? "Unknown series"}
                                                {event.chapterTitle ? ` · ${event.chapterTitle}` : ""}
                                            </span>
                                            {event.createdAt && (
                                                <span className="shrink-0 font-mono text-[10px] text-text-faint">
                                                    {new Date(event.createdAt).toLocaleDateString()}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-text-faint">No activity yet.</p>
                            )}
                        </div>

                        <div className="space-y-1.5 border-t border-border-subtle pt-3">
                            <p className="text-[10px] uppercase tracking-[0.14em] text-text-faint">Monthly summary</p>
                            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                                {memory.stats.monthlySummaries.map((month) => (
                                    <div key={month.month} className="rounded-sm bg-surface-raised px-2.5 py-1.5 text-xs">
                                        <p className="font-mono text-[10px] text-text-faint">{month.month}</p>
                                        <p className="text-text-muted">{month.completedChapters} completed</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-text-faint">Memory overview unavailable.</p>
                )}
            </SectionCard>


            <SectionCard>
                <SectionHeader
                    title="Tags"
                    description="Label series with colored tags for quick filtering."
                />

                <form
                    onSubmit={(e) => void handleCreateTag(e)}
                    className="mb-4 flex flex-wrap gap-2"
                >
                    <InputField
                        value={tagName}
                        onChange={(e) => setTagName(e.target.value)}
                        placeholder="Tag name"
                        className="min-w-0 flex-1"
                    />

                    <div className="flex items-center gap-1 rounded-sm border border-border bg-surface-raised px-2">
                        {TAG_PRESETS.map((preset) => (
                            <button
                                key={preset}
                                type="button"
                                onClick={() => setTagColor(preset)}
                                className={cn(
                                    "h-4 w-4 rounded-full border transition-transform",
                                    tagColor === preset
                                        ? "scale-110 border-text"
                                        : "border-transparent hover:scale-105",
                                )}
                                style={{ backgroundColor: preset }}
                                aria-label={`Color ${preset}`}
                            />
                        ))}
                        <input
                            type="color"
                            value={tagColor}
                            onChange={(e) => setTagColor(e.target.value)}
                            className="ml-1 h-5 w-5 cursor-pointer rounded-sm border-0 bg-transparent p-0"
                            aria-label="Custom color"
                        />
                    </div>

                    <SelectDropdown
                        value={tagType}
                        onChange={(e) => setTagType(e.target.value as TagType)}
                        className="w-28"
                        aria-label="Tag type"
                    >
                        {TAG_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </SelectDropdown>

                    <button
                        type="submit"
                        disabled={savingTag || !tagName.trim()}
                        className="flex shrink-0 items-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-xs font-medium text-void transition-colors hover:bg-accent-muted disabled:opacity-50"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add
                    </button>
                </form>

                {!loadedSections.tags ? (
                    <div className="flex items-center gap-2 py-6 text-xs text-text-faint">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                        Loading tags…
                    </div>
                ) : tags.length === 0 ? (
                    <p className="py-6 text-center text-xs text-text-faint">
                        No tags yet. Create one to start labeling series.
                    </p>
                ) : (
                    <div className="space-y-3">
                        {(["genre", "mood", "theme", "custom"] as const)
                            .map((type) => {
                                const groupTags = tags.filter((t) => t.type === type);
                                if (groupTags.length === 0) return null;
                                return (
                                    <div key={type}>
                                        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.15em] text-text-faint">
                                            {type}
                                        </p>
                                        <div className="space-y-0.5">
                                            {groupTags.map((tag) =>
                                                editTagId === tag.id ? (
                                                    <div
                                                        key={tag.id}
                                                        className="flex flex-wrap items-center gap-2 rounded-sm bg-surface-raised px-3 py-2"
                                                    >
                                                        <InputField
                                                            value={editTagName}
                                                            onChange={(e) =>
                                                                setEditTagName(e.target.value)
                                                            }
                                                            className="min-w-0 flex-1"
                                                            autoFocus
                                                        />
                                                        <div className="flex items-center gap-1 rounded-sm border border-border bg-surface px-1.5 py-0.5">
                                                            {TAG_PRESETS.map((preset) => (
                                                                <button
                                                                    key={preset}
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setEditTagColor(preset)
                                                                    }
                                                                    className={cn(
                                                                        "h-3.5 w-3.5 rounded-full border transition-transform",
                                                                        editTagColor === preset
                                                                            ? "scale-110 border-text"
                                                                            : "border-transparent hover:scale-105",
                                                                    )}
                                                                    style={{
                                                                        backgroundColor: preset,
                                                                    }}
                                                                />
                                                            ))}
                                                            <input
                                                                type="color"
                                                                value={editTagColor}
                                                                onChange={(e) =>
                                                                    setEditTagColor(e.target.value)
                                                                }
                                                                className="ml-0.5 h-4 w-4 cursor-pointer border-0 bg-transparent p-0"
                                                            />
                                                        </div>
                                                        <SelectDropdown
                                                            value={editTagType}
                                                            onChange={(e) =>
                                                                setEditTagType(
                                                                    e.target.value as TagType,
                                                                )
                                                            }
                                                            className="w-28"
                                                        >
                                                            {TAG_TYPE_OPTIONS.map((opt) => (
                                                                <option
                                                                    key={opt.value}
                                                                    value={opt.value}
                                                                >
                                                                    {opt.label}
                                                                </option>
                                                            ))}
                                                        </SelectDropdown>
                                                        <button
                                                            onClick={() =>
                                                                void handleUpdateTag(tag.id)
                                                            }
                                                            disabled={savingTag}
                                                            className="rounded-sm p-1.5 text-completed transition-colors hover:bg-completed/10 disabled:opacity-50"
                                                            aria-label="Save"
                                                        >
                                                            <Check className="h-3.5 w-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => setEditTagId(null)}
                                                            className="rounded-sm p-1.5 text-text-faint transition-colors hover:text-text-muted"
                                                            aria-label="Cancel"
                                                        >
                                                            <X className="h-3.5 w-3.5" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div
                                                        key={tag.id}
                                                        className="group flex items-center gap-2.5 rounded-sm px-3 py-1.5 transition-colors hover:bg-surface-raised"
                                                    >
                                                        <span
                                                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                                                            style={{
                                                                backgroundColor:
                                                                    tag.color ?? "#6e7291",
                                                            }}
                                                        />
                                                        <span className="min-w-0 flex-1 text-sm text-text">
                                                            {tag.name}
                                                        </span>
                                                        <span className="font-mono text-[10px] text-text-faint">
                                                            {tag.seriesCount}
                                                        </span>
                                                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                                            <button
                                                                onClick={() => {
                                                                    setEditTagId(tag.id);
                                                                    setEditTagName(tag.name);
                                                                    setEditTagColor(
                                                                        tag.color ?? "#c94a3a",
                                                                    );
                                                                    setEditTagType(tag.type);
                                                                }}
                                                                className="rounded-sm p-1 text-text-faint transition-colors hover:text-text-muted"
                                                                aria-label={`Edit ${tag.name}`}
                                                            >
                                                                <Pencil className="h-3.5 w-3.5" />
                                                            </button>
                                                            <button
                                                                onClick={() =>
                                                                    void handleDeleteTag(tag.id)
                                                                }
                                                                disabled={savingTag}
                                                                className="rounded-sm p-1 text-text-faint transition-colors hover:text-dropped disabled:opacity-50"
                                                                aria-label={`Delete ${tag.name}`}
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ),
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                            .filter(Boolean)}
                    </div>
                )}
            </SectionCard>
        </div>
    );
}
