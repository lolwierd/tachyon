/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderView } from "./reader-view";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />,
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
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
  } = {},
) {
  const { readingDirection = "ltr" } = options;
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
    if (url === "/api/reader/state?seriesId=series-1&chapterId=chapter-1") {
      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue({
          preferences: { readingDirection, fitMode: "width" },
          progress: { currentPage: 0, completed: false, updatedAt: null },
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
    await screen.findByRole("img", { name: "Page 1" });

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
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/chapters/chapter-1/pages?seriesId=series-1&source=oppai") {
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(pages) });
      }
      if (url === "/api/series/series-1/chapters?source=oppai") {
        return Promise.resolve({ ok: true, json: vi.fn().mockResolvedValue(chapters) });
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
      if (url === "/api/reader/state" && (init?.method === "PATCH" || init?.method === "POST")) {
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
    await screen.findByRole("img", { name: "Page 1" });

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

  it("preloads ahead in vertical mode too", async () => {
    setupFetch({ readingDirection: "vertical" });
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
    await screen.findByRole("img", { name: "Page 1" });

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
      await screen.findByRole("img", { name: "Page 1" });

      await waitFor(() => {
        expect(started).toEqual([
          "https://img.example/2.jpg",
          "https://img.example/3.jpg",
          "https://img.example/4.jpg",
        ]);
      });

      const currentImage = screen.getByRole("img", { name: "Page 1" });
      fireEvent.load(currentImage);

      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "ArrowRight" });

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
