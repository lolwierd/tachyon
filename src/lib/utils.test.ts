import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges truthy class names", () => {
    expect(cn("base", false && "hidden", "active")).toBe("base active");
  });

  it("lets tailwind-merge resolve conflicting utilities", () => {
    expect(cn("px-2 text-sm", "px-4", "text-lg")).toBe("px-4 text-lg");
  });
});
