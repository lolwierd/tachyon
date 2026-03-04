"use client";

import { useEffect } from "react";

export function PwaRegister() {
    useEffect(() => {
        if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
            return;
        }

        if (navigator.webdriver) {
            return;
        }

        const register = async () => {
            try {
                await navigator.serviceWorker.register("/sw.js", { scope: "/" });
            } catch {
                // Best effort only.
            }
        };

        void register();
    }, []);

    return null;
}
