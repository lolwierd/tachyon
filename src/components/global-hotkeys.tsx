"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

export function GlobalHotkeys() {
    const router = useRouter();
    const pathname = usePathname();
    const pendingGotoRef = useRef<number | null>(null);

    useEffect(() => {
        function resetPendingGoto() {
            if (pendingGotoRef.current != null) {
                window.clearTimeout(pendingGotoRef.current);
            }
            pendingGotoRef.current = null;
        }

        function inTextContext(target: EventTarget | null) {
            const el = target as HTMLElement | null;
            return Boolean(
                el &&
                (el.tagName === "INPUT" ||
                    el.tagName === "TEXTAREA" ||
                    el.isContentEditable),
            );
        }

        function handleKeyDown(event: KeyboardEvent) {
            if (event.metaKey || event.ctrlKey || event.altKey) {
                return;
            }

            if (inTextContext(event.target)) {
                return;
            }

            const key = event.key.toLowerCase();

            if (key === "g") {
                resetPendingGoto();
                pendingGotoRef.current = window.setTimeout(() => {
                    pendingGotoRef.current = null;
                }, 750);
                return;
            }

            if (pendingGotoRef.current != null) {
                if (key === "l") {
                    event.preventDefault();
                    router.push("/");
                } else if (key === "s") {
                    event.preventDefault();
                    router.push("/search");
                } else if (key === "d") {
                    event.preventDefault();
                    router.push("/downloads");
                } else if (key === "u") {
                    event.preventDefault();
                    router.push("/updates");
                } else if (key === "m") {
                    event.preventDefault();
                    router.push("/manage");
                }
                resetPendingGoto();
                return;
            }

            if (event.key === "/") {
                event.preventDefault();
                if (pathname !== "/") {
                    router.push("/");
                    return;
                }

                const input = document.querySelector<HTMLInputElement>("input[placeholder='Search in library…']");
                input?.focus();
            }
        }

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            resetPendingGoto();
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [pathname, router]);

    return null;
}
