"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, useCallback, type ReactNode } from "react";

interface NsfwContextValue {
  // Whether the user has opted in to viewing adult content this session.
  // Always false when `nsfwAllowed` is false, regardless of stored state.
  nsfwEnabled: boolean;
  // Whether the server has adult content enabled at all (NSFW_ENABLED=1).
  // When false, the whole adult surface — toggles, tabs, "Move to NSFW"
  // buttons — should hide. Resolved server-side at render time and
  // passed through props so there's no flash-of-wrong-state.
  nsfwAllowed: boolean;
  setNsfwEnabled: (enabled: boolean) => void;
}

const NsfwContext = createContext<NsfwContextValue>({
  nsfwEnabled: false,
  nsfwAllowed: false,
  setNsfwEnabled: () => {},
});

const SS_KEY = "nsfw_enabled";

function readSessionStorage(): boolean {
  try {
    return sessionStorage.getItem(SS_KEY) === "1";
  } catch {
    return false;
  }
}

const subscribers = new Set<() => void>();
let snapshot = false;

function subscribe(cb: () => void) {
  subscribers.add(cb);
  return () => { subscribers.delete(cb); };
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return false;
}

function setStorage(enabled: boolean) {
  snapshot = enabled;
  try {
    if (enabled) {
      sessionStorage.setItem(SS_KEY, "1");
    } else {
      sessionStorage.removeItem(SS_KEY);
    }
  } catch {}
  for (const cb of subscribers) cb();
}

// Initialize snapshot on module load (client only)
if (typeof window !== "undefined") {
  snapshot = readSessionStorage();
}

export function NsfwProvider({
  children,
  nsfwAllowed,
}: {
  children: ReactNode;
  // Passed from the root layout (server component) based on
  // NSFW_ENABLED env. Defaults false so a missing prop collapses safely
  // to the restrictive state.
  nsfwAllowed: boolean;
}) {
  const storedEnabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const nsfwEnabled = nsfwAllowed && storedEnabled;

  // Proactively clear stale sessionStorage when the server disallows
  // NSFW. Without this, a user who had the toggle on before the admin
  // flipped NSFW_ENABLED off keeps `nsfw_enabled=1` in storage — and
  // the instant the admin flips it back on later, NSFW auto-resurrects
  // without any user consent. Clearing here closes that loop because
  // no setter needs to fire for the reset to happen.
  useEffect(() => {
    if (!nsfwAllowed && storedEnabled) {
      setStorage(false);
    }
  }, [nsfwAllowed, storedEnabled]);

  const setNsfwEnabled = useCallback(
    (enabled: boolean) => {
      // Hard no-op when the server won't allow it. The effect above
      // handles the initial clear; this guards against any consumer
      // that tries to setNsfwEnabled(true) while the toggle UI is
      // hidden (shouldn't happen, but defensive).
      if (!nsfwAllowed) {
        if (storedEnabled) setStorage(false);
        return;
      }
      setStorage(enabled);
    },
    [nsfwAllowed, storedEnabled],
  );

  return (
    <NsfwContext.Provider value={{ nsfwEnabled, nsfwAllowed, setNsfwEnabled }}>
      {children}
    </NsfwContext.Provider>
  );
}

export function useNsfw() {
  return useContext(NsfwContext);
}
