import { afterEach, describe, expect, it } from "vitest";

import { isNsfwEnabled } from "./config";

const ORIGINAL = process.env.NSFW_ENABLED;

describe("isNsfwEnabled", () => {
  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.NSFW_ENABLED;
    } else {
      process.env.NSFW_ENABLED = ORIGINAL;
    }
  });

  it("returns true only when NSFW_ENABLED is exactly \"1\"", () => {
    process.env.NSFW_ENABLED = "1";
    expect(isNsfwEnabled()).toBe(true);
  });

  it.each(["0", "", "true", "false", "yes", "on"])(
    "returns false for ambiguous value %j",
    (value) => {
      process.env.NSFW_ENABLED = value;
      expect(isNsfwEnabled()).toBe(false);
    },
  );

  it("returns false when unset", () => {
    delete process.env.NSFW_ENABLED;
    expect(isNsfwEnabled()).toBe(false);
  });
});
