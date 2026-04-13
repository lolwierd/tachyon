"use client";

import { cn } from "@/lib/utils";
import { BookOpen, Search, Settings, Download, HardDrive, RefreshCw, BarChart3, Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useActiveDownloadCount } from "@/lib/background/use-active-downloads";
import { useActiveCacheCount } from "@/lib/offline/cache-queue";

const PRIMARY_TABS = [
    { href: "/", label: "Library", icon: BookOpen },
    { href: "/search", label: "Search", icon: Search },
    { href: "/updates", label: "Updates", icon: RefreshCw },
    { href: "/downloads", label: "Down", icon: Download },
];

const MORE_ITEMS = [
    { href: "/cache", label: "Cache", icon: HardDrive },
    { href: "/stats", label: "Stats", icon: BarChart3 },
    { href: "/manage", label: "Manage", icon: Settings },
];

function isActive(pathname: string, href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
}

export function BottomTabs() {
    const pathname = usePathname();
    const activeDownloads = useActiveDownloadCount();
    const activeCache = useActiveCacheCount();
    const [moreOpen, setMoreOpen] = useState(false);

    const closeMore = useCallback(() => setMoreOpen(false), []);

    // Close sheet on navigation
    useEffect(() => {
        setMoreOpen(false);
    }, [pathname]);

    const moreIsActive = MORE_ITEMS.some((item) => isActive(pathname, item.href));
    const moreBadge = activeCache;

    return (
        <>
            {/* More sheet backdrop + panel */}
            {moreOpen && (
                <div
                    className="fixed inset-0 z-40 bg-void/60 backdrop-blur-sm md:hidden"
                    onClick={closeMore}
                >
                    <div
                        className="absolute inset-x-0 bottom-0 rounded-t-xl border-t border-border-subtle bg-surface pb-[calc(4rem+env(safe-area-inset-bottom))]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="mx-auto mt-2 h-1 w-8 rounded-full bg-text-faint/30" />
                        <nav className="flex flex-col px-2 py-3">
                            {MORE_ITEMS.map((item) => {
                                const active = isActive(pathname, item.href);
                                const badge = item.href === "/cache" ? activeCache : 0;
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        className={cn(
                                            "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors",
                                            active
                                                ? "bg-accent/10 text-accent"
                                                : "text-text-muted active:bg-surface-hover",
                                        )}
                                    >
                                        <div className="relative">
                                            <item.icon className="h-5 w-5" />
                                            {badge > 0 && (
                                                <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />
                                            )}
                                        </div>
                                        <span>{item.label}</span>
                                        {badge > 0 && (
                                            <span className="ml-auto rounded-full bg-accent/20 px-1.5 py-0.5 font-mono text-[10px] font-medium text-accent">
                                                {badge}
                                            </span>
                                        )}
                                    </Link>
                                );
                            })}
                        </nav>
                    </div>
                </div>
            )}

            {/* Bottom tab bar */}
            <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border-subtle bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
                {PRIMARY_TABS.map((item) => {
                    const active = isActive(pathname, item.href);
                    const badge = item.href === "/downloads" ? activeDownloads : 0;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors duration-150",
                                active ? "text-accent" : "text-text-faint",
                            )}
                        >
                            <div className="relative">
                                <item.icon className="h-5 w-5" />
                                {badge > 0 && (
                                    <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />
                                )}
                            </div>
                            <span>{item.label}</span>
                            {active && (
                                <span className="absolute left-1/2 top-0 h-0.5 w-6 -translate-x-1/2 rounded-full bg-accent" />
                            )}
                        </Link>
                    );
                })}

                {/* More button */}
                <button
                    type="button"
                    onClick={() => setMoreOpen((v) => !v)}
                    className={cn(
                        "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors duration-150",
                        moreIsActive || moreOpen ? "text-accent" : "text-text-faint",
                    )}
                >
                    <div className="relative">
                        <Ellipsis className="h-5 w-5" />
                        {moreBadge > 0 && (
                            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />
                        )}
                    </div>
                    <span>More</span>
                    {moreIsActive && !moreOpen && (
                        <span className="absolute left-1/2 top-0 h-0.5 w-6 -translate-x-1/2 rounded-full bg-accent" />
                    )}
                </button>
            </nav>
        </>
    );
}
