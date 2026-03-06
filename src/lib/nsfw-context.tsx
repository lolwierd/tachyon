"use client";

import { createContext, useContext, useSyncExternalStore, useCallback, type ReactNode } from "react";

interface NsfwContextValue {
  nsfwEnabled: boolean;
  setNsfwEnabled: (enabled: boolean) => void;
}

const NsfwContext = createContext<NsfwContextValue>({
  nsfwEnabled: false,
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

export function NsfwProvider({ children }: { children: ReactNode }) {
  const nsfwEnabled = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setNsfwEnabled = useCallback((enabled: boolean) => {
    setStorage(enabled);
  }, []);

  return (
    <NsfwContext.Provider value={{ nsfwEnabled, setNsfwEnabled }}>
      {children}
    </NsfwContext.Provider>
  );
}

export function useNsfw() {
  return useContext(NsfwContext);
}
