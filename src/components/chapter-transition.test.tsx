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
});
