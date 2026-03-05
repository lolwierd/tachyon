/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { Cover } from "./cover";

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

describe("Cover", () => {
  it("retries loading when src changes after an error", () => {
    const { rerender } = render(<Cover src="/broken.jpg" alt="Alpha" />);

    fireEvent.error(screen.getByRole("img", { name: "Alpha" }));
    expect(screen.getByText("No cover")).toBeInTheDocument();

    rerender(<Cover src="/fresh.jpg" alt="Alpha" />);
    expect(screen.queryByText("No cover")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Alpha" })).toHaveAttribute("src", "/fresh.jpg");
  });
});
