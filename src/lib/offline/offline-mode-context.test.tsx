/* @vitest-environment jsdom */

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
    const flushOutboxMock = vi.fn(async () => ({ succeeded: 0, failed: 0 }));
    const getOutboxCountMock = vi.fn(async () => 0);
    const subscribers = new Set<(count: number) => void>();
    const subscribeOutboxMock = vi.fn((listener: (count: number) => void) => {
        subscribers.add(listener);
        return () => {
            subscribers.delete(listener);
        };
    });
    return { flushOutboxMock, getOutboxCountMock, subscribeOutboxMock, subscribers };
});
const { flushOutboxMock, getOutboxCountMock, subscribers } = hoisted;

function emitOutboxCount(count: number) {
    for (const listener of subscribers) listener(count);
}

vi.mock("./outbox", () => ({
    flushOutbox: hoisted.flushOutboxMock,
    getOutboxCount: hoisted.getOutboxCountMock,
    subscribeOutbox: hoisted.subscribeOutboxMock,
}));

import { OfflineModeProvider } from "./offline-mode-context";

function setManualOffline(on: boolean) {
    if (on) window.localStorage.setItem("offline:mode-enabled", "1");
    else window.localStorage.removeItem("offline:mode-enabled");
}

describe("OfflineModeProvider heartbeat", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        flushOutboxMock.mockClear();
        getOutboxCountMock.mockClear();
        subscribers.clear();
        setManualOffline(false);
        Object.defineProperty(navigator, "onLine", {
            configurable: true,
            get: () => true,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("retries flushOutbox on a successful /api/health ping when writes are pending", async () => {
        const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);
        getOutboxCountMock.mockResolvedValue(2);

        render(
            <OfflineModeProvider>
                <div />
            </OfflineModeProvider>,
        );

        // Drain microtasks + initial tick so pingHealth resolves and the
        // pendingWrites subscription publishes.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });

        expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.any(Object));

        // A heartbeat tick that pings successfully with pending writes > 0
        // must retry the drain. This is the behavior that unsticks the
        // "N to sync" pill after a mid-drain 5xx — without it, the outbox
        // would sit untouched until the user flipped connectivity.
        flushOutboxMock.mockClear();
        await act(async () => {
            emitOutboxCount(2);
            // Advance past the scheduled healthy-cadence tick (10s) so the
            // loop fires a follow-up ping while pendingWrites > 0.
            await vi.advanceTimersByTimeAsync(11_000);
        });
        expect(flushOutboxMock).toHaveBeenCalled();
    });

    it("does not ping /api/health when manual offline is on", async () => {
        const fetchMock = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) =>
                new Response(null, { status: 200 }),
        );
        vi.stubGlobal("fetch", fetchMock);
        setManualOffline(true);
        getOutboxCountMock.mockResolvedValueOnce(3);

        render(
            <OfflineModeProvider>
                <div />
            </OfflineModeProvider>,
        );

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            // Advance past several heartbeat intervals to be sure no ping slips
            // through while manual offline is on.
            await vi.advanceTimersByTimeAsync(30_000);
        });

        const healthCalls = fetchMock.mock.calls.filter(
            (args) => String(args[0]) === "/api/health",
        );
        expect(healthCalls).toHaveLength(0);
        // triggerFlush gates on effectiveOnline (false when manualOffline), so
        // no flush should run either.
        expect(flushOutboxMock).not.toHaveBeenCalled();
    });
});
