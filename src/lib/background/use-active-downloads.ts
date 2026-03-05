"use client";

import { useEffect, useState } from "react";

/**
 * Polls the downloads API and returns the number of currently active
 * (queued / running / canceling) download runs.
 */
export function useActiveDownloadCount(pollInterval = 10_000) {
    const [count, setCount] = useState(0);

    useEffect(() => {
        async function poll() {
            try {
                const res = await fetch("/api/downloads/runs?activeOnly=true&countOnly=true");
                if (!res.ok) return;
                const body = (await res.json()) as { count?: number };
                setCount(typeof body.count === "number" ? body.count : 0);
            } catch {
                // silent – navigation should not be disrupted by a failed poll
            }
        }

        void poll();
        const id = setInterval(() => void poll(), pollInterval);
        return () => clearInterval(id);
    }, [pollInterval]);

    return count;
}
