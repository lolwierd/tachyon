// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChapterTransition } from "./chapter-transition";

describe("ChapterTransition", () => {
  it("advances on pointer up", () => {
    const onAdvance = vi.fn();

    render(
      <ChapterTransition
        completedTitle="Chapter 1"
        nextTitle="Chapter 2"
        onAdvance={onAdvance}
      />,
    );

    fireEvent.pointerUp(screen.getByRole("button", { name: "Advance to Chapter 2" }));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("advances on Enter key", () => {
    const onAdvance = vi.fn();

    render(
      <ChapterTransition
        completedTitle="Chapter 1"
        nextTitle="Chapter 2"
        onAdvance={onAdvance}
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Advance to Chapter 2" }), {
      key: "Enter",
    });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("advances on Space key", () => {
    const onAdvance = vi.fn();

    render(
      <ChapterTransition
        completedTitle="Chapter 1"
        nextTitle="Chapter 2"
        onAdvance={onAdvance}
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Advance to Chapter 2" }), {
      key: " ",
    });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("advances on any non-modifier key", () => {
    const onAdvance = vi.fn();

    render(
      <ChapterTransition
        completedTitle="Chapter 1"
        nextTitle="Chapter 2"
        onAdvance={onAdvance}
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Advance to Chapter 2" }), {
      key: "j",
    });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("advances when overscroll threshold is reached", () => {
    const onAdvance = vi.fn();

    render(
      <ChapterTransition
        completedTitle="Chapter 1"
        nextTitle="Chapter 2"
        onAdvance={onAdvance}
      />,
    );

    const transition = screen.getByRole("button", { name: "Advance to Chapter 2" });
    fireEvent.wheel(transition, { deltaY: 120 });
    fireEvent.wheel(transition, { deltaY: 120 });

    expect(onAdvance).toHaveBeenCalledTimes(1);
  });
});
