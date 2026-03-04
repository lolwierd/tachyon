"use client";

import { cn } from "@/lib/utils";
import {
    BookOpen,
    Search,
    Settings,
    PanelLeftClose,
    PanelLeftOpen,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV_ITEMS = [
    { href: "/", label: "Library", icon: BookOpen },
    { href: "/search", label: "Search", icon: Search },
    { href: "/manage", label: "Manage", icon: Settings },
];

function isActive(pathname: string, href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
    const pathname = usePathname();
    const [expanded, setExpanded] = useState(() => {
        if (typeof window !== "undefined") {
            return localStorage.getItem("sidebar-expanded") === "true";
        }
        return false;
    });

    const toggle = () => {
        setExpanded((prev) => {
            localStorage.setItem("sidebar-expanded", String(!prev));
            return !prev;
        });
    };

    return (
        <aside
            className={cn(
                "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-border-subtle bg-void transition-[width] duration-200 ease-out md:flex",
                expanded ? "w-[var(--sidebar-expanded)]" : "w-[var(--sidebar-collapsed)]",
            )}
        >
            {/* Wordmark */}
            <div className={cn("flex h-14 items-center", expanded ? "px-4" : "justify-center")}>
                <Link href="/" className="flex items-center gap-2 overflow-hidden">
                    <span className="font-display text-lg text-text">R</span>
                    {expanded && (
                        <span className="truncate font-display text-lg text-text">
                            eader
                        </span>
                    )}
                </Link>
            </div>

            {/* Nav items */}
            <nav className="mt-2 flex flex-1 flex-col gap-0.5 px-2">
                {NAV_ITEMS.map((item) => {
                    const active = isActive(pathname, item.href);
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
                            {/* Active indicator: cinnabar bar on left */}
                            {active && (
                                <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent" />
                            )}
                            <item.icon className="h-4 w-4 shrink-0" />
                            {expanded && (
                                <span className="truncate">{item.label}</span>
                            )}
                        </Link>
                    );
                })}
            </nav>

            {/* Collapse toggle */}
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
