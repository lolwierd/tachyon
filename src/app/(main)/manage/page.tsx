"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { InputField } from "@/components/ui/input";
import { SelectDropdown } from "@/components/ui/select";

/* ── Types ── */

interface CollectionRecord {
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    createdAt: string | null;
    seriesCount: number;
}

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

/* ── Section Card wrapper ── */

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

/* ── Page ── */

export default function ManagePage() {
    const [loading, setLoading] = useState(true);
    const [collections, setCollections] = useState<CollectionRecord[]>([]);
    const [tags, setTags] = useState<TagRecord[]>([]);
    const [aniList, setAniList] = useState<AniListOverview | null>(null);

    // Collection form
    const [colName, setColName] = useState("");
    const [colDesc, setColDesc] = useState("");
    const [savingCol, setSavingCol] = useState(false);
    const [editColId, setEditColId] = useState<string | null>(null);
    const [editColName, setEditColName] = useState("");
    const [editColDesc, setEditColDesc] = useState("");

    // Tag form
    const [tagName, setTagName] = useState("");
    const [tagColor, setTagColor] = useState("#c94a3a");
    const [tagType, setTagType] = useState<TagType>("custom");
    const [savingTag, setSavingTag] = useState(false);
    const [editTagId, setEditTagId] = useState<string | null>(null);
    const [editTagName, setEditTagName] = useState("");
    const [editTagColor, setEditTagColor] = useState("#c94a3a");
    const [editTagType, setEditTagType] = useState<TagType>("custom");

    // AniList
    const [aniListBusy, setAniListBusy] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const [colRes, tagRes, alRes] = await Promise.all([
                    fetch("/api/collections"),
                    fetch("/api/tags"),
                    fetch("/api/anilist/status"),
                ]);
                if (!cancelled) {
                    setCollections(colRes.ok ? await colRes.json() : []);
                    setTags(tagRes.ok ? await tagRes.json() : []);
                    setAniList(alRes.ok ? await alRes.json() : null);
                }
            } catch {
                if (!cancelled) {
                    setCollections([]);
                    setTags([]);
                    setAniList(null);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, []);

    /* ── AniList handlers ── */

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

    /* ── Collection handlers ── */

    async function handleCreateCol(e: React.FormEvent) {
        e.preventDefault();
        if (!colName.trim()) return;
        setSavingCol(true);
        try {
            const res = await fetch("/api/collections", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: colName, description: colDesc }),
            });
            if (res.ok) {
                const next = (await res.json()) as CollectionRecord;
                setCollections((c) => [...c, next].sort((a, b) => a.sortOrder - b.sortOrder));
                setColName("");
                setColDesc("");
            }
        } finally {
            setSavingCol(false);
        }
    }

    async function handleUpdateCol(id: string) {
        if (!editColName.trim()) return;
        setSavingCol(true);
        try {
            const res = await fetch(`/api/collections/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: editColName, description: editColDesc }),
            });
            if (res.ok) {
                const next = (await res.json()) as CollectionRecord;
                setCollections((c) => c.map((x) => (x.id === id ? next : x)));
                setEditColId(null);
            }
        } finally {
            setSavingCol(false);
        }
    }

    async function handleDeleteCol(id: string) {
        setSavingCol(true);
        try {
            const res = await fetch(`/api/collections/${id}`, { method: "DELETE" });
            if (res.ok) setCollections((c) => c.filter((x) => x.id !== id));
        } finally {
            setSavingCol(false);
        }
    }

    /* ── Tag handlers ── */

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

    /* ── Loading ── */

    if (loading) {
        return (
            <div className="flex items-center justify-center py-32">
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
            </div>
        );
    }

    /* ── Render ── */

    return (
        <div className="space-y-6 pb-20">
            {/* Page header */}
            <div>
                <h1 className="font-display text-3xl leading-none text-text">Manage</h1>
                <p className="mt-1 text-xs text-text-faint">
                    Organize your library with collections, tags, and connected services.
                </p>
            </div>

            {/* ── AniList ── */}
            <SectionCard>
                <SectionHeader title="AniList" description="Sync reading progress with AniList." />

                {aniList?.connected ? (
                    <div className="space-y-4">
                        {/* Connection status strip */}
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

                        {/* Actions */}
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

                        {/* Recent logs */}
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

            {/* ── Collections ── */}
            <SectionCard>
                <SectionHeader
                    title="Collections"
                    description="Group series into shelves. Collections appear as tabs on your library."
                />

                {/* Create form */}
                <form
                    onSubmit={(e) => void handleCreateCol(e)}
                    className="mb-4 flex gap-2"
                >
                    <InputField
                        value={colName}
                        onChange={(e) => setColName(e.target.value)}
                        placeholder="Collection name"
                        className="flex-1"
                    />
                    <InputField
                        value={colDesc}
                        onChange={(e) => setColDesc(e.target.value)}
                        placeholder="Description (optional)"
                        className="hidden flex-1 sm:block"
                    />
                    <button
                        type="submit"
                        disabled={savingCol || !colName.trim()}
                        className="flex shrink-0 items-center gap-1.5 rounded-sm bg-accent px-3 py-2 text-xs font-medium text-void transition-colors hover:bg-accent-muted disabled:opacity-50"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add
                    </button>
                </form>

                {/* Collection list */}
                {collections.length === 0 ? (
                    <p className="py-6 text-center text-xs text-text-faint">
                        No collections yet. Create one to organize your library.
                    </p>
                ) : (
                    <div className="space-y-1">
                        {collections.map((col) =>
                            editColId === col.id ? (
                                /* Edit mode */
                                <div
                                    key={col.id}
                                    className="flex items-center gap-2 rounded-sm bg-surface-raised px-3 py-2"
                                >
                                    <InputField
                                        value={editColName}
                                        onChange={(e) => setEditColName(e.target.value)}
                                        className="flex-1"
                                        autoFocus
                                    />
                                    <InputField
                                        value={editColDesc}
                                        onChange={(e) => setEditColDesc(e.target.value)}
                                        placeholder="Description"
                                        className="hidden flex-1 sm:block"
                                    />
                                    <button
                                        onClick={() => void handleUpdateCol(col.id)}
                                        disabled={savingCol}
                                        className="rounded-sm p-1.5 text-completed transition-colors hover:bg-completed/10 disabled:opacity-50"
                                        aria-label="Save"
                                    >
                                        <Check className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                        onClick={() => setEditColId(null)}
                                        className="rounded-sm p-1.5 text-text-faint transition-colors hover:text-text-muted"
                                        aria-label="Cancel"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ) : (
                                /* Display mode */
                                <div
                                    key={col.id}
                                    className="group flex items-center gap-3 rounded-sm px-3 py-2 transition-colors hover:bg-surface-raised"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm text-text">{col.name}</p>
                                        {col.description && (
                                            <p className="truncate text-xs text-text-faint">
                                                {col.description}
                                            </p>
                                        )}
                                    </div>
                                    <span className="font-mono text-[10px] text-text-faint">
                                        {col.seriesCount} series
                                    </span>
                                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                        <button
                                            onClick={() => {
                                                setEditColId(col.id);
                                                setEditColName(col.name);
                                                setEditColDesc(col.description ?? "");
                                            }}
                                            className="rounded-sm p-1 text-text-faint transition-colors hover:text-text-muted"
                                            aria-label={`Edit ${col.name}`}
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            onClick={() => void handleDeleteCol(col.id)}
                                            disabled={savingCol}
                                            className="rounded-sm p-1 text-text-faint transition-colors hover:text-dropped disabled:opacity-50"
                                            aria-label={`Delete ${col.name}`}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ),
                        )}
                    </div>
                )}
            </SectionCard>

            {/* ── Tags ── */}
            <SectionCard>
                <SectionHeader
                    title="Tags"
                    description="Label series with colored tags for quick filtering."
                />

                {/* Create form */}
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

                    {/* Color preset picker */}
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
                        {/* Custom color fallback */}
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

                {/* Tag list — grouped by type */}
                {tags.length === 0 ? (
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
                                                    /* Edit mode */
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
                                                    /* Display mode */
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
