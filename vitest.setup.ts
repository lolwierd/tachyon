import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { useTestDb as setupTestDb } from "@/lib/db/test-utils";

// Ensure every test runs against an isolated in-memory database.
setupTestDb();

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

if (typeof window !== "undefined") {
  const store = new Map<string, string>();
  const localStorageMock: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: localStorageMock,
  });

  Object.defineProperty(window, "scrollTo", {
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window, "scrollBy", {
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window, "requestAnimationFrame", {
    writable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0),
  });

  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    writable: true,
    value: vi.fn(),
  });
}

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

import React from "react";

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("next/image", () => ({
  default: (props: any) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { fill, priority, unoptimized, ...rest } = props;
    return React.createElement("img", rest);
  },
}));
