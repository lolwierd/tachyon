/* @vitest-environment jsdom */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { VerticalScrobbler } from "./vertical-scrobbler";

// jsdom's PointerEvent doesn't thread clientY through the init dict, so
// pointer handlers receive NaN coords. Polyfill via MouseEvent which jsdom
// handles correctly; the pointerId/pointerType fields we use are tacked on.
// Default pointerType to "mouse" so the mouse-only guards in the component
// are actually exercised by the existing tests.
class PointerEventPolyfill extends window.MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "mouse";
  }
}
const originalPointerEvent = (window as unknown as { PointerEvent?: unknown })
  .PointerEvent;
beforeAll(() => {
  // @ts-expect-error: polyfill for jsdom
  window.PointerEvent = PointerEventPolyfill;
  // @ts-expect-error: polyfill for jsdom
  globalThis.PointerEvent = PointerEventPolyfill;
});
afterAll(() => {
  // @ts-expect-error: restore
  window.PointerEvent = originalPointerEvent;
  // @ts-expect-error: restore
  globalThis.PointerEvent = originalPointerEvent;
});

const pages = Array.from({ length: 10 }).map((_, i) => ({
  index: i,
  imageUrl: `https://img.example/${i + 1}.jpg`,
}));

function stubLayout(el: HTMLElement, height = 900) {
  el.getBoundingClientRect = () => ({
    top: 0,
    bottom: height,
    height,
    left: 0,
    right: 24,
    width: 24,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  // jsdom doesn't implement pointer capture; stub for pointer handlers.
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  el.hasPointerCapture = () => true;
}

describe("VerticalScrobbler", () => {
  it("renders nothing when not visible", () => {
    const { container } = render(
      <VerticalScrobbler
        pages={pages}
        currentPage={0}
        onScrubTo={() => {}}
        visible={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are no pages", () => {
    const { container } = render(
      <VerticalScrobbler
        pages={[]}
        currentPage={0}
        onScrubTo={() => {}}
        visible
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("exposes the current page through ARIA slider attributes", () => {
    render(
      <VerticalScrobbler
        pages={pages}
        currentPage={3}
        onScrubTo={() => {}}
        visible
      />,
    );
    const slider = screen.getByRole("slider", { name: "Reading position" });
    expect(slider).toHaveAttribute("aria-valuenow", "4");
    expect(slider).toHaveAttribute("aria-valuemin", "1");
    expect(slider).toHaveAttribute("aria-valuemax", "10");
    expect(slider).toHaveAttribute("aria-valuetext", "Page 4 of 10");
    expect(slider).toHaveAttribute("aria-orientation", "vertical");
  });

  it("scrubs to the pointer-down page immediately", () => {
    const onScrubTo = vi.fn();
    render(
      <VerticalScrobbler
        pages={pages}
        currentPage={0}
        onScrubTo={onScrubTo}
        visible
      />,
    );
    const slider = screen.getByRole("slider");
    stubLayout(slider);

    // Click at the very bottom of the 900px rail → last page (index 9).
    fireEvent.pointerDown(slider, { clientY: 900, button: 0, pointerId: 1 });
    expect(onScrubTo).toHaveBeenCalledWith(9);
  });

  it("scrubs continuously while dragging", () => {
    const onScrubTo = vi.fn();
    render(
      <VerticalScrobbler
        pages={pages}
        currentPage={0}
        onScrubTo={onScrubTo}
        visible
      />,
    );
    const slider = screen.getByRole("slider");
    stubLayout(slider);

    fireEvent.pointerDown(slider, { clientY: 0, button: 0, pointerId: 1 });
    expect(onScrubTo).toHaveBeenLastCalledWith(0);

    // Drag to 50% → round(0.5 * 9) = round(4.5) = 5.
    fireEvent.pointerMove(slider, { clientY: 450, pointerId: 1 });
    expect(onScrubTo).toHaveBeenLastCalledWith(5);

    fireEvent.pointerMove(slider, { clientY: 900, pointerId: 1 });
    expect(onScrubTo).toHaveBeenLastCalledWith(9);

    fireEvent.pointerUp(slider, { pointerId: 1 });
  });

  it("does not repeat scrub callbacks for the same page during a drag", () => {
    const onScrubTo = vi.fn();
    render(
      <VerticalScrobbler
        pages={pages}
        currentPage={0}
        onScrubTo={onScrubTo}
        visible
      />,
    );
    const slider = screen.getByRole("slider");
    stubLayout(slider);

    fireEvent.pointerDown(slider, { clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientY: 105, pointerId: 1 });
    fireEvent.pointerMove(slider, { clientY: 110, pointerId: 1 });
    // All three map to the same rounded page → one scrub only.
    expect(onScrubTo).toHaveBeenCalledTimes(1);
  });

  it("navigates pages via keyboard", () => {
    const onScrubTo = vi.fn();
    render(
      <VerticalScrobbler
        pages={pages}
        currentPage={2}
        onScrubTo={onScrubTo}
        visible
      />,
    );
    const slider = screen.getByRole("slider");

    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onScrubTo).toHaveBeenLastCalledWith(3);

    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(onScrubTo).toHaveBeenLastCalledWith(7);

    fireEvent.keyDown(slider, { key: "End" });
    expect(onScrubTo).toHaveBeenLastCalledWith(9);

    fireEvent.keyDown(slider, { key: "Home" });
    expect(onScrubTo).toHaveBeenLastCalledWith(0);
  });

  it("ignores right-click on pointer down", () => {
    const onScrubTo = vi.fn();
    render(
      <VerticalScrobbler
        pages={pages}
        currentPage={0}
        onScrubTo={onScrubTo}
        visible
      />,
    );
    const slider = screen.getByRole("slider");
    stubLayout(slider);

    fireEvent.pointerDown(slider, {
      clientY: 450,
      button: 2,
      pointerType: "mouse",
      pointerId: 1,
    });
    expect(onScrubTo).not.toHaveBeenCalled();
  });

  it("keeps the rail blossomed after mouse release (lets pointerleave retract)", () => {
    vi.useFakeTimers();
    try {
      const onScrubTo = vi.fn();
      render(
        <VerticalScrobbler
          pages={pages}
          currentPage={0}
          onScrubTo={onScrubTo}
          visible
        />,
      );
      const slider = screen.getByRole("slider");
      stubLayout(slider);

      fireEvent.pointerDown(slider, {
        clientY: 450,
        button: 0,
        pointerType: "mouse",
        pointerId: 1,
      });
      expect(slider.className).toContain("w-6");

      fireEvent.pointerUp(slider, { pointerType: "mouse", pointerId: 1 });
      // Mouse release should NOT schedule auto-retract — rail stays open
      // until pointerleave.
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(slider.className).toContain("w-6");

      // pointerleave closes it after the retract timer.
      fireEvent.pointerLeave(slider);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(slider.className).toContain("w-4");
    } finally {
      vi.useRealTimers();
    }
  });

  it("retracts after touch release (no hover state to wait for)", () => {
    vi.useFakeTimers();
    try {
      const onScrubTo = vi.fn();
      render(
        <VerticalScrobbler
          pages={pages}
          currentPage={0}
          onScrubTo={onScrubTo}
          visible
        />,
      );
      const slider = screen.getByRole("slider");
      stubLayout(slider);

      fireEvent.pointerDown(slider, {
        clientY: 450,
        button: 0,
        pointerType: "touch",
        pointerId: 1,
      });
      expect(slider.className).toContain("w-6");

      fireEvent.pointerUp(slider, { pointerType: "touch", pointerId: 1 });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(slider.className).toContain("w-4");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not blossom from a touch pointerenter (avoids stray edge swipes)", () => {
    render(
      <VerticalScrobbler
        pages={pages}
        currentPage={0}
        onScrubTo={() => {}}
        visible
      />,
    );
    const slider = screen.getByRole("slider");
    fireEvent.pointerEnter(slider, { pointerType: "touch" });
    expect(slider.className).toContain("w-4");
  });

  it("shows a preview chip with the target page number while dragging", () => {
    const onScrubTo = vi.fn();
    render(
      <VerticalScrobbler
        pages={pages}
        currentPage={0}
        onScrubTo={onScrubTo}
        visible
      />,
    );
    const slider = screen.getByRole("slider");
    stubLayout(slider);

    // Before drag, the chip is absent.
    expect(screen.queryByText("of 10")).not.toBeInTheDocument();

    fireEvent.pointerDown(slider, { clientY: 450, button: 0, pointerId: 1 });
    // Now the chip should render with the target page's ordinal.
    expect(screen.getByText("of 10")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });
});
