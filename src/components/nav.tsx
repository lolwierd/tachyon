"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/search", label: "Search", icon: Search },
  { href: "/library", label: "Library", icon: BookOpen },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-border/50 bg-surface/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link
          href="/"
          className="text-lg font-semibold tracking-tight text-text transition-colors hover:text-accent"
        >
          Reader
        </Link>

        <div className="flex items-center gap-1">
          {links.map(({ href, label, icon: Icon }) => {
            const isActive =
              pathname === href || pathname.startsWith(href + "/");

            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent-faint text-accent"
                    : "text-text-muted hover:bg-surface-raised hover:text-text",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
