/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes, ImgHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderView } from "./reader-view";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ fill, priority, unoptimized, ...props }: ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean;
    priority?: boolean;
    unoptimized?: boolean;
  }) => {
    void fill;
    void priority;
    void unoptimized;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={props.alt ?? ""} {...props} />;
  },
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const enqueueProgressMock = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/offline/outbox", () => ({
  enqueueProgress: (...args: unknown[]) => enqueueProgressMock(...args),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const pages = Array.from({ length: 12 }).map((_, index) => ({
  index,
  imageUrl: `https://img.example/${index + 1}.jpg`,
}));

const chapters = [
  { sourceChapterId: "chapter-1", chapterNo: 1, title: "Chapter 1" },
  { sourceChapterId: "chapter-2", chapterNo: 2, title: "Chapter 2" },
];

function setupFetch(
  options: {
    readingDirection?: "vertical" | "ltr" | "rtl";
    currentPage?: number;
  } = {},
) {
  const { readingDirection = "ltr", currentPage = 0 } = options;
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/chapters/chapter-1/pages?seriesId=series-1") {
      return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(pages) });
    }
    if (url === "/api/chapters/chapter-2/pages?seriesId=series-1") {
      return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(pages) });
    }
    if (url === "/api/series/series-1/chapters") {
      return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(chapters) });
    }
    if (url === "/api/series/series-1") {
      return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({ title: "Test Series", coverUrl: null }) });
    }
    if (url === "/api/reader/state?seriesId=series-1&chapterId=chapter-1") {
      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue({
          preferences: { readingDirection, fitMode: "width" },
          progress: { currentPage, completed: false, updatedAt: null },
        }),
      });
    }
    if (url === "/api/reader/state?seriesId=series-1&chapterId=chapter-2") {
      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue({
          preferences: { readingDirection, fitMode: "width" },
          progress: { currentPage: 0, completed: false, updatedAt: null },
        }),
      });
    }
    if (url === "/api/reader/state" && (init?.method === "PATCH" || init?.method === "POST")) {
      return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({}) });
    }
    throw new Error(`Unhandled fetch: ${url}`);
  });
}

describe("ReaderView", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    pushMock.mockReset();
    enqueueProgressMock.mockClear();
    window.localStorage.clear();
    window.scrollTo = vi.fn();
    vi.useRealTimers();
  });

  it("preloads next 5 pages by default in paged mode", async () => {
    setupFetch();
    const preloaded: string[] = [];
    const originalImage = window.Image;
    class MockImage {
      onload: (() => void) | null = null;
      set src(value: string) {
        if (!value) {
          return;
        }
        preloaded.push(value);
        this.onload?.();
      }
    }
    window.Image = MockImage as unknown as typeof window.Image;

    render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
    const page1 = await screen.findByRole("img", { name: "Page 1" });
    fireEvent.load(page1);

    await waitFor(() => {
      expect(preloaded).toEqual([
        "https://img.example/2.jpg",
        "https://img.example/3.jpg",
        "https://img.example/4.jpg",
        "https://img.example/5.jpg",
        "https://img.example/6.jpg",
        "https://img.example/7.jpg",
        "https://img.example/8.jpg",
        "https://img.example/9.jpg",
        "https://img.example/10.jpg",
        "https://img.example/11.jpg",
      ]);
    });

    window.Image = originalImage;
  });

  it("requests chapter pages and chapter list with explicit source when provided", async () => {
    const postBodies: Array<Record<string, unknown>> = [];
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/chapters/chapter-1/pages?seriesId=series-1&source=oppai") {
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(pages) });
      }
      if (url === "/api/series/series-1/chapters?source=oppai") {
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(chapters) });
      }
      if (url === "/api/reader/state?seriesId=series-1&chapterId=chapter-1&source=oppai") {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            preferences: { readingDirection: "ltr", fitMode: "width" },
            progress: { currentPage: 0, completed: false, updatedAt: null },
          }),
        });
      }
      if (url === "/api/series/series-1?source=oppai") {
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({ title: "Test Series", coverUrl: null }) });
      }
      if (url === "/api/reader/state" && (init?.method === "PATCH" || init?.method === "POST")) {
        if (init?.method === "POST") {
          postBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        }
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({}) });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    render(<ReaderView seriesId="series-1" seriesSource="oppai" chapterId="chapter-1" />);
    await screen.findByRole("img", { name: "Page 1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chapters/chapter-1/pages?seriesId=series-1&source=oppai",
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/series/series-1/chapters?source=oppai");
    expect(fetchMock).toHaveBeenCalledWith("/api/reader/state?seriesId=series-1&chapterId=chapter-1&source=oppai");

    fireEvent.keyDown(window, { key: "m" });

    const patchCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url) === "/api/reader/state" && init?.method === "PATCH",
    );
    expect(patchCall?.[1]?.body ? JSON.parse(String(patchCall[1].body)).source : undefined).toBe("oppai");
    expect(postBodies.every((body) => body.source === "oppai")).toBe(true);
  });

  it("flushes a completed save before moving to the next chapter from the last page", async () => {
    setupFetch({ currentPage: pages.length - 1 });

    render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
    // Wait for paged mode to be active (LTR preferences loaded from API),
    // not just "Page 12" which also matches in the default vertical mode.
    await screen.findByRole("button", { name: "Next page" });

    fireEvent.keyDown(window, { key: "ArrowRight" });

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === "/api/reader/state" && init?.method === "POST",
      );

      expect(saveCall).toBeDefined();
      expect(pushMock).toHaveBeenCalledWith("/read/~c2VyaWVzLTE/~Y2hhcHRlci0y");

      const body = JSON.parse(String(saveCall?.[1]?.body)) as Record<string, unknown>;
      expect(body.currentPage).toBe(pages.length - 1);
      expect(body.completed).toBe(true);
      expect(saveCall?.[1]?.keepalive).toBe(true);
    });
  });

  it("does not queue an aborted progress save to the offline outbox", async () => {
    // Regression: previously, when a debounced POST to /api/reader/state was
    // superseded (another save scheduled, or reader unmounted), the aborted
    // fetch rejected with AbortError and hit the generic .catch() that
    // enqueued the stale payload — so users online saw "1 to sync" pop up
    // after finishing a chapter.
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/chapters/chapter-1/pages?seriesId=series-1") {
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(pages) });
      }
      if (url === "/api/series/series-1/chapters") {
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(chapters) });
      }
      if (url === "/api/series/series-1") {
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({ title: "Test Series", coverUrl: null }) });
      }
      if (url === "/api/reader/state?seriesId=series-1&chapterId=chapter-1") {
        return Promise.resolve({
          ok: true,
          json: vi.fn().mockResolvedValue({
            preferences: { readingDirection: "ltr", fitMode: "width" },
            progress: { currentPage: 0, completed: false, updatedAt: null },
          }),
        });
      }
      if (url === "/api/reader/state" && init?.method === "POST") {
        // Non-keepalive saves pass an AbortSignal. Hang until aborted so we
        // can prove the catch handler doesn't wrongly enqueue.
        if (init.keepalive) {
          return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({}) });
        }
        return new Promise((_resolve, reject) => {
          const signal = init.signal;
          if (!signal) return;
          const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort);
        });
      }
      if (url === "/api/reader/state" && init?.method === "PATCH") {
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue({}) });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    const { unmount } = render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
    await screen.findByRole("button", { name: "Next page" });

    // Kick off a debounced save, then let the 800ms timer fire so the fetch
    // actually starts and registers an abort signal.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, init]) => String(url) === "/api/reader/state" && init?.method === "POST" && !init?.keepalive,
      );
      expect(postCall).toBeDefined();
    });

    // Unmount to trigger clearPendingProgressSave → controller.abort() on the
    // in-flight POST. The mock rejects with AbortError; the catch must NOT
    // enqueue to the outbox.
    unmount();

    // Give the rejection a microtask to propagate.
    await new Promise((r) => setTimeout(r, 0));

    expect(enqueueProgressMock).not.toHaveBeenCalled();
  });

  it("uses persisted preload window from localStorage", async () => {
    setupFetch();
    window.localStorage.setItem("reader:preload-window", "8");
    const preloaded: string[] = [];
    const originalImage = window.Image;
    class MockImage {
      onload: (() => void) | null = null;
      set src(value: string) {
        if (!value) {
          return;
        }
        preloaded.push(value);
        this.onload?.();
      }
    }
    window.Image = MockImage as unknown as typeof window.Image;

    render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
    const page1 = await screen.findByRole("img", { name: "Page 1" });
    fireEvent.load(page1);

    await waitFor(() => {
      expect(preloaded).toEqual([
        "https://img.example/2.jpg",
        "https://img.example/3.jpg",
        "https://img.example/4.jpg",
        "https://img.example/5.jpg",
        "https://img.example/6.jpg",
        "https://img.example/7.jpg",
        "https://img.example/8.jpg",
        "https://img.example/9.jpg",
        "https://img.example/10.jpg",
        "https://img.example/11.jpg",
        "https://img.example/12.jpg",
      ]);
    });

    window.Image = originalImage;
  });

  it("marks future pages in vertical mode as loading='eager' across the preload lookahead", async () => {
    // In vertical mode we rely on DOM-eager <img> tags (not the new-Image
    // preload pool) to fetch future pages, because native loading="lazy"
    // refuses to render already-cached bytes until the viewport-proximity
    // trigger fires — during scrobble / fast scrolls the user sees black
    // until images reach viewport center. The eager range now matches the
    // preload lookahead so every image the pool *would* have prefetched
    // is instead fetched directly by the <img> with "eager".
    setupFetch({ readingDirection: "vertical" });
    window.localStorage.setItem("reader:preload-window", "3");

    render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
    await screen.findByRole("img", { name: "Page 1" });

    // preloadWindow=3 × PRELOAD_MULTIPLIER=2 → pages 0..6 eager, 7..11 lazy.
    await waitFor(() => {
      for (let i = 1; i <= 7; i += 1) {
        expect(screen.getByRole("img", { name: `Page ${i}` })).toHaveAttribute("loading", "eager");
      }
    });
    for (let i = 8; i <= 12; i += 1) {
      expect(screen.getByRole("img", { name: `Page ${i}` })).toHaveAttribute("loading", "lazy");
    }
  });

  it("marks nearer vertical pages with higher fetch priority", async () => {
    setupFetch({ readingDirection: "vertical" });

    render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);

    const page1 = await screen.findByRole("img", { name: "Page 1" });
    const page2 = screen.getByRole("img", { name: "Page 2" });
    const page3 = screen.getByRole("img", { name: "Page 3" });
    const page4 = screen.getByRole("img", { name: "Page 4" });
    const page5 = screen.getByRole("img", { name: "Page 5" });
    const page10 = screen.getByRole("img", { name: "Page 10" });

    expect(page1).toHaveAttribute("fetchpriority", "high");
    expect(page2).toHaveAttribute("fetchpriority", "high");
    expect(page3).toHaveAttribute("fetchpriority", "high");
    expect(page4).toHaveAttribute("fetchpriority", "auto");
    expect(page5).toHaveAttribute("fetchpriority", "auto");
    expect(page10).toHaveAttribute("fetchpriority", "low");
  });

  it("uses the preload window as concurrency and cancels stale preloads on jumps", async () => {
    setupFetch();
    window.localStorage.setItem("reader:preload-window", "3");

    const started: string[] = [];
    const cleared: string[] = [];
    const originalImage = window.Image;

    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private currentSrc = "";

      set src(value: string) {
        if (value === "") {
          if (this.currentSrc) {
            cleared.push(this.currentSrc);
          }
          this.currentSrc = "";
          return;
        }

        this.currentSrc = value;
        started.push(value);
      }
    }

    window.Image = MockImage as unknown as typeof window.Image;

    try {
      render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
      const currentImage = await screen.findByRole("img", { name: "Page 1" });
      fireEvent.load(currentImage);

      await waitFor(() => {
        expect(started).toEqual([
          "https://img.example/2.jpg",
          "https://img.example/3.jpg",
          "https://img.example/4.jpg",
        ]);
      });

      // Advance a page at a time, firing load on each new visible image so the
      // preload gate opens and the pool fills as the window slides forward.
      for (let pageNumber = 2; pageNumber <= 6; pageNumber += 1) {
        fireEvent.keyDown(window, { key: "ArrowRight" });
        const visible = await screen.findByRole("img", { name: `Page ${pageNumber}` });
        fireEvent.load(visible);
      }

      await waitFor(() => {
        expect(cleared).toEqual(expect.arrayContaining([
          "https://img.example/2.jpg",
          "https://img.example/3.jpg",
          "https://img.example/4.jpg",
        ]));
      });

      await waitFor(() => {
        expect(started).toEqual([
          "https://img.example/2.jpg",
          "https://img.example/3.jpg",
          "https://img.example/4.jpg",
          "https://img.example/5.jpg",
          "https://img.example/6.jpg",
          "https://img.example/7.jpg",
          "https://img.example/8.jpg",
          "https://img.example/9.jpg",
        ]);
      });
    } finally {
      window.Image = originalImage;
    }
  });

  it("keeps the paged image hidden until it finishes loading", async () => {
    setupFetch();

    render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
    const image = await screen.findByRole("img", { name: "Page 1" });

    expect(image.className).toContain("opacity-0");

    fireEvent.load(image);

    await waitFor(() => {
      expect(screen.getByRole("img", { name: "Page 1" }).className).not.toContain("opacity-0");
    });
  });

  it("toggles autoscroll in vertical mode via keyboard", async () => {
    setupFetch({ readingDirection: "vertical" });
    const originalRaf = window.requestAnimationFrame;
    const originalCaf = window.cancelAnimationFrame;
    const rafSpy = vi.fn(() => 1);
    window.requestAnimationFrame = rafSpy;
    window.cancelAnimationFrame = vi.fn();

    try {
      render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
      await screen.findByRole("img", { name: "Page 1" });

      fireEvent.keyDown(window, { key: "a" });
      await waitFor(() => {
        expect(rafSpy).toHaveBeenCalled();
      });

      rafSpy.mockClear();
      fireEvent.keyDown(window, { key: "a" });
      await waitFor(() => {
        expect(window.cancelAnimationFrame).toHaveBeenCalled();
      });
    } finally {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCaf;
    }
  });

  it("toggles autoscroll in vertical mode via spacebar", async () => {
    setupFetch({ readingDirection: "vertical" });
    const originalRaf = window.requestAnimationFrame;
    const originalCaf = window.cancelAnimationFrame;
    const rafSpy = vi.fn(() => 1);
    window.requestAnimationFrame = rafSpy;
    window.cancelAnimationFrame = vi.fn();

    try {
      render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
      await screen.findByRole("img", { name: "Page 1" });

      fireEvent.keyDown(window, { key: " ", code: "Space" });
      await waitFor(() => {
        expect(rafSpy).toHaveBeenCalled();
      });
    } finally {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCaf;
    }
  });

  it("persists autoscroll across chapter navigation within the same tab session", async () => {
    setupFetch({ readingDirection: "vertical" });
    const originalRaf = window.requestAnimationFrame;
    const originalCaf = window.cancelAnimationFrame;
    const rafSpy = vi.fn(() => 1);
    window.requestAnimationFrame = rafSpy;
    window.cancelAnimationFrame = vi.fn();

    try {
      const { rerender } = render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
      await screen.findByRole("img", { name: "Page 1" });

      fireEvent.keyDown(window, { key: "a" });
      await waitFor(() => {
        expect(rafSpy).toHaveBeenCalled();
      });

      rafSpy.mockClear();

      rerender(<ReaderView seriesId="series-1" chapterId="chapter-2" />);

      await waitFor(() => {
        expect(rafSpy).toHaveBeenCalled();
      });
    } finally {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCaf;
    }
  });

  it("persists autoscroll speed across reader remounts in the same tab", async () => {
    setupFetch({ readingDirection: "vertical" });
    window.localStorage.setItem("reader:autoscroll-speed", "120");

    const first = render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
    await screen.findByRole("img", { name: "Page 1" });

    // Open settings modal to verify the speed display
    fireEvent.click(screen.getByRole("button", { name: "Reader settings" }));
    await waitFor(() => {
      expect(screen.getByText("120 px/s")).toBeInTheDocument();
    });

    first.unmount();

    render(<ReaderView seriesId="series-1" chapterId="chapter-2" />);
    await screen.findByRole("img", { name: "Page 1" });

    fireEvent.click(screen.getByRole("button", { name: "Reader settings" }));
    await waitFor(() => {
      expect(screen.getByText("120 px/s")).toBeInTheDocument();
    });
    expect(window.localStorage.getItem("reader:autoscroll-speed")).toBe("120");
  });

  it("toggles autoscroll on double-tap in vertical mode", async () => {
    setupFetch({ readingDirection: "vertical" });
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    const rafSpy = vi.fn(() => 1);
    window.requestAnimationFrame = rafSpy;
    window.cancelAnimationFrame = vi.fn();

    try {
      render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
      await screen.findByRole("img", { name: "Page 1" });

      rafSpy.mockClear();

      const image = screen.getByRole("img", { name: "Page 1" });
      const readerSurface = image.parentElement?.parentElement as HTMLElement;

      // Double-click to toggle autoscroll
      fireEvent.click(readerSurface);
      fireEvent.click(readerSurface);

      await waitFor(() => {
        expect(rafSpy).toHaveBeenCalled();
      });
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });

  it("adjusts autoscroll speed via keyboard shortcuts", async () => {
    setupFetch({ readingDirection: "vertical" });
    const originalRaf = window.requestAnimationFrame;
    const originalCaf = window.cancelAnimationFrame;
    window.requestAnimationFrame = vi.fn(() => 1);
    window.cancelAnimationFrame = vi.fn();

    try {
      render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
      await screen.findByRole("img", { name: "Page 1" });

      // Default speed is 70, stored on mount
      await waitFor(() => {
        expect(window.localStorage.getItem("reader:autoscroll-speed")).toBe("70");
      });

      // '+' increases speed: 70 -> 90
      fireEvent.keyDown(window, { key: "+" });
      await waitFor(() => {
        expect(window.localStorage.getItem("reader:autoscroll-speed")).toBe("90");
      });

      // '-' decreases speed: 90 -> 70
      fireEvent.keyDown(window, { key: "-" });
      await waitFor(() => {
        expect(window.localStorage.getItem("reader:autoscroll-speed")).toBe("70");
      });
    } finally {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCaf;
    }
  });

  it("clamps autoscroll speed to max 500", async () => {
    setupFetch({ readingDirection: "vertical" });
    window.localStorage.setItem("reader:autoscroll-speed", "499");
    const originalRaf = window.requestAnimationFrame;
    const originalCaf = window.cancelAnimationFrame;
    window.requestAnimationFrame = vi.fn(() => 1);
    window.cancelAnimationFrame = vi.fn();

    try {
      render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
      await screen.findByRole("img", { name: "Page 1" });

      // 499 normalizes to 500 (nearest option)
      await waitFor(() => {
        expect(window.localStorage.getItem("reader:autoscroll-speed")).toBe("500");
      });

      fireEvent.keyDown(window, { key: "+" });
      await waitFor(() => {
        expect(window.localStorage.getItem("reader:autoscroll-speed")).toBe("500");
      });

      fireEvent.keyDown(window, { key: "+" });
      await waitFor(() => {
        expect(window.localStorage.getItem("reader:autoscroll-speed")).toBe("500");
      });
    } finally {
      window.requestAnimationFrame = originalRaf;
      window.cancelAnimationFrame = originalCaf;
    }
  });

  it("stops autoscroll when it reaches chapter bottom", async () => {
    setupFetch({ readingDirection: "vertical" });
    window.localStorage.setItem("reader:autoscroll-speed", "500");

    let scrollY = 0;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => scrollY,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 650,
    });

    window.scrollBy = vi.fn((x?: number | ScrollToOptions, y?: number) => {
      if (typeof x === "object") {
        scrollY += Number(x.top ?? 0);
        return;
      }
      scrollY += Number(y ?? 0);
    });

    const rafCallbacks = new Map<number, FrameRequestCallback>();
    let rafId = 0;
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      rafId += 1;
      rafCallbacks.set(rafId, callback);
      return rafId;
    };
    window.cancelAnimationFrame = (id: number) => {
      rafCallbacks.delete(id);
    };

    const runFrames = (timestamp: number) => {
      const pending = Array.from(rafCallbacks.entries());
      if (pending.length === 0) throw new Error("Expected at least one scheduled animation frame");
      rafCallbacks.clear();
      pending.forEach(([, callback]) => callback(timestamp));
    };

    try {
      render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
      await screen.findByRole("img", { name: "Page 1" });

      fireEvent.keyDown(window, { key: "a" });
      await waitFor(() => {
        expect(rafCallbacks.size).toBeGreaterThan(0);
      });

      await act(async () => {
        runFrames(0);
      });
      await act(async () => {
        runFrames(64);
      });
      await waitFor(() => {
        expect(window.scrollBy).toHaveBeenCalled();
        expect(scrollY).toBeGreaterThan(0);
      });

      await act(async () => {
        runFrames(128);
      });
      await act(async () => {
        runFrames(192);
      });
      await act(async () => {
        runFrames(256);
      });
      await act(async () => {
        runFrames(320);
      });
      // After reaching bottom, no more animation frames should be scheduled
      await waitFor(() => {
        expect(rafCallbacks.size).toBe(0);
      });
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  }, 8000);
});
