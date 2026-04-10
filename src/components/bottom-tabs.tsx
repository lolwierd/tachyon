"use client";

import { cn } from "@/lib/utils";
import { BookOpen, Search, Settings, Download, RefreshCw, BarChart3 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActiveDownloadCount } from "@/lib/background/use-active-downloads";

const TAB_ITEMS = [
    { href: "/", label: "Library", icon: BookOpen },
    { href: "/search", label: "Search", icon: Search },
    { href: "/downloads", label: "Down", icon: Download },
    { href: "/updates", label: "Updates", icon: RefreshCw },
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

    return (
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border-subtle bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
            {TAB_ITEMS.map((item) => {
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
                            <span className="absolute bottom-[env(safe-area-inset-bottom)] h-0.5 w-6 rounded-full bg-accent" />
                        )}
                    </Link>
                );
            })}
        </nav>
    );
}
