"use client";

import { cn } from "@/lib/utils";
import {
    BookOpen,
    Search,
    Settings,
    Download,
    RefreshCw,
    PanelLeftClose,
    PanelLeftOpen,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";
import { useActiveDownloadCount } from "@/lib/background/use-active-downloads";

function TachyonIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" className={className}>
            <circle cx="256" cy="256" r="24" fill="currentColor" />
            <line x1="256" y1="160" x2="256" y2="200" stroke="currentColor" strokeWidth="8" strokeLinecap="round" opacity="0.7" />
            <line x1="256" y1="312" x2="256" y2="352" stroke="currentColor" strokeWidth="8" strokeLinecap="round" opacity="0.7" />
            <line x1="160" y1="256" x2="200" y2="256" stroke="currentColor" strokeWidth="8" strokeLinecap="round" opacity="0.7" />
            <line x1="312" y1="256" x2="352" y2="256" stroke="currentColor" strokeWidth="8" strokeLinecap="round" opacity="0.7" />
            <line x1="188" y1="188" x2="216" y2="216" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity="0.4" />
            <line x1="296" y1="296" x2="324" y2="324" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity="0.4" />
            <line x1="324" y1="188" x2="296" y2="216" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity="0.4" />
            <line x1="188" y1="324" x2="216" y2="296" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity="0.4" />
        </svg>
    );
}

const SIDEBAR_EXPANDED_KEY = "sidebar-expanded";
const subscribers = new Set<() => void>();
let snapshot = false;

function readSidebarExpanded() {
    try {
        return localStorage.getItem(SIDEBAR_EXPANDED_KEY) === "true";
    } catch {
        return false;
    }
}

function subscribe(callback: () => void) {
    subscribers.add(callback);

    if (typeof window === "undefined") {
        return () => {
            subscribers.delete(callback);
        };
    }

    const onStorage = (event: StorageEvent) => {
        if (event.key !== SIDEBAR_EXPANDED_KEY) {
            return;
        }
        snapshot = event.newValue === "true";
        callback();
    };

    window.addEventListener("storage", onStorage);

    return () => {
        subscribers.delete(callback);
        window.removeEventListener("storage", onStorage);
    };
}

function getSnapshot() {
    return snapshot;
}

function getServerSnapshot() {
    return false;
}

function setSidebarExpanded(nextValue: boolean) {
    snapshot = nextValue;
    try {
        localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(nextValue));
    } catch {}

    for (const callback of subscribers) {
        callback();
    }
}

if (typeof window !== "undefined") {
    snapshot = readSidebarExpanded();
}

const NAV_ITEMS = [
    { href: "/", label: "Library", icon: BookOpen },
    { href: "/search", label: "Search", icon: Search },
    { href: "/downloads", label: "Downloads", icon: Download },
    { href: "/updates", label: "Updates", icon: RefreshCw },
    { href: "/manage", label: "Manage", icon: Settings },
];

function isActive(pathname: string, href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
    const pathname = usePathname();
    const activeDownloads = useActiveDownloadCount();
    const expanded = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const toggle = useCallback(() => {
        setSidebarExpanded(!expanded);
    }, [expanded]);

    return (
        <aside
            className={cn(
                "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border-subtle bg-void transition-[width] duration-200 ease-out md:flex",
                expanded ? "w-[var(--sidebar-expanded)]" : "w-[var(--sidebar-collapsed)]",
            )}
        >
            <div className={cn("flex h-14 items-center", expanded ? "px-4" : "justify-center")}>
                <Link href="/" className="flex items-center gap-2 overflow-hidden">
                    <TachyonIcon className="h-9 w-9 shrink-0 text-text" />
                    {expanded && (
                        <span className="truncate font-display text-lg text-text">
                            Tachyon
                        </span>
                    )}
                </Link>
            </div>

            <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-2">
                {NAV_ITEMS.map((item) => {
                    const active = isActive(pathname, item.href);
                    const badge = item.href === "/downloads" ? activeDownloads : 0;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "group relative flex items-center gap-3 rounded-sm px-2.5 py-2 text-sm transition-colors duration-150",
                                active
                                    ? "text-text"
                                    : "text-text-muted hover:bg-surface-hover hover:text-text",
                            )}
                        >
                            {active && (
                                <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent" />
                            )}
                            <div className="relative shrink-0">
                                <item.icon className="h-4 w-4" />
                                {badge > 0 && (
                                    <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />
                                )}
                            </div>
                            {expanded && (
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            )}
                            {expanded && badge > 0 && (
                                <span className="ml-auto rounded-full bg-accent/20 px-1.5 py-0.5 font-mono text-[9px] font-medium text-accent">
                                    {badge}
                                </span>
                            )}
                        </Link>
                    );
                })}
            </nav>

            <div className="border-t border-border-subtle p-2">
                <button
                    type="button"
                    onClick={toggle}
                    className="flex w-full items-center justify-center rounded-sm py-2 text-text-faint transition-colors duration-150 hover:bg-surface-hover hover:text-text-muted"
                    aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
                >
                    {expanded ? (
                        <PanelLeftClose className="h-4 w-4" />
                    ) : (
                        <PanelLeftOpen className="h-4 w-4" />
                    )}
                </button>
            </div>
        </aside>
    );
}
