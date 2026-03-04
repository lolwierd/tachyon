"use client";

import { cn } from "@/lib/utils";
import { BookOpen, Search, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TAB_ITEMS = [
    { href: "/", label: "Library", icon: BookOpen },
    { href: "/search", label: "Search", icon: Search },
    { href: "/manage", label: "Manage", icon: Settings },
];

function isActive(pathname: string, href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
}

export function BottomTabs() {
    const pathname = usePathname();

    return (
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border-subtle bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
            {TAB_ITEMS.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                            "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors duration-150",
                            active ? "text-accent" : "text-text-faint",
                        )}
                    >
                        <item.icon className="h-5 w-5" />
                        <span>{item.label}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
