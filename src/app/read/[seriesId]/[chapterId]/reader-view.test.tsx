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

type NextImageMockProps = ImgHTMLAttributes<HTMLImageElement> & {
  src?: string;
  fill?: boolean;
  priority?: boolean;
  unoptimized?: boolean;
};

vi.mock("next/image", () => ({
  default: ({
    alt,
    src,
    fill: _fill,
    priority: _priority,
    unoptimized: _unoptimized,
    ...props
  }: NextImageMockProps) => (
    <img alt={alt} src={src} {...props} />
  ),
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
    if (url === "/api/chapters/chapter-1/pages") {
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
  });

  it("preloads next 5 pages by default in paged mode", async () => {
    setupFetch();
    const preloaded: string[] = [];
    const originalImage = window.Image;
    class MockImage {
      set src(value: string) {
        preloaded.push(value);
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
      ]);
    });

    window.Image = originalImage;
  });

  it("uses persisted preload window from localStorage", async () => {
    setupFetch();
    window.localStorage.setItem("reader:preload-window", "8");
    const preloaded: string[] = [];
    const originalImage = window.Image;
    class MockImage {
      set src(value: string) {
        preloaded.push(value);
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
      ]);
    });

    window.Image = originalImage;
  });

  it("toggles autoscroll in vertical mode via keyboard", async () => {
    setupFetch({ readingDirection: "vertical" });

    render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
    await screen.findByRole("img", { name: "Page 1" });

    expect(screen.getByRole("button", { name: "Start autoscroll" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop autoscroll" })).toBeInTheDocument();
    });
    expect(window.localStorage.getItem("reader:autoscroll-enabled")).toBe("1");

    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start autoscroll" })).toBeInTheDocument();
    });
  });

  it("adjusts autoscroll speed from controls and keyboard", async () => {
    setupFetch({ readingDirection: "vertical" });

    render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
    await screen.findByRole("img", { name: "Page 1" });

    expect(screen.getByRole("combobox", { name: "Autoscroll speed" })).toHaveValue("70");

    fireEvent.change(screen.getByRole("combobox", { name: "Autoscroll speed" }), {
      target: { value: "90" },
    });
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Autoscroll speed" })).toHaveValue("90");
    });
    expect(window.localStorage.getItem("reader:autoscroll-speed")).toBe("90");

    fireEvent.keyDown(window, { key: "-" });
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Autoscroll speed" })).toHaveValue("70");
    });
    expect(window.localStorage.getItem("reader:autoscroll-speed")).toBe("70");
  });

  it("clamps autoscroll speed to max 500", async () => {
    setupFetch({ readingDirection: "vertical" });
    window.localStorage.setItem("reader:autoscroll-speed", "499");

    render(<ReaderView seriesId="series-1" chapterId="chapter-1" />);
    await screen.findByRole("img", { name: "Page 1" });

    expect(screen.getByRole("combobox", { name: "Autoscroll speed" })).toHaveValue("500");

    fireEvent.keyDown(window, { key: "+" });
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Autoscroll speed" })).toHaveValue("500");
    });
    expect(window.localStorage.getItem("reader:autoscroll-speed")).toBe("500");

    fireEvent.keyDown(window, { key: "+" });
    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Autoscroll speed" })).toHaveValue("500");
    });
    expect(window.localStorage.getItem("reader:autoscroll-speed")).toBe("500");
  });

  it("stops autoscroll when it reaches chapter bottom", async () => {
    setupFetch({ readingDirection: "vertical" });
    window.localStorage.setItem("reader:autoscroll-enabled", "1");
    window.localStorage.setItem("reader:autoscroll-speed", "100");

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

    window.scrollTo = vi.fn((arg?: ScrollToOptions | number, y?: number) => {
      if (typeof arg === "object") {
        scrollY = Number(arg.top ?? scrollY);
        return;
      }
      if (typeof arg === "number") {
        scrollY = Number(y ?? scrollY);
      }
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
      expect(screen.getByRole("button", { name: "Stop autoscroll" })).toBeInTheDocument();

      await act(async () => {
        runFrames(0);
      });
      await act(async () => {
        runFrames(1000);
      });
      await waitFor(() => {
        expect(window.scrollTo).toHaveBeenCalled();
        expect(scrollY).toBeGreaterThan(0);
      });

      await act(async () => {
        runFrames(2000);
      });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Start autoscroll" })).toBeInTheDocument();
      });
      expect(window.localStorage.getItem("reader:autoscroll-enabled")).toBe("0");
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    }
  });
});
