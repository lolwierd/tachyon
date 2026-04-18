import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSource, registerSource } from "./registry";

const ORIGINAL = process.env.NSFW_ENABLED;

function fakeSource(name: string, isNsfw: boolean) {
  return {
    name,
    displayName: name,
    baseUrl: `https://${name}.test`,
    isNsfw,
    search: async () => [],
    getSeriesDetail: async () => {
      throw new Error("not used");
    },
    getChapterList: async () => [],
    getChapterPages: async () => [],
  };
}

describe("registerSource NSFW gate", () => {
  // The registry's `sources` Map is module-scoped, so any registration
  // leaks across tests unless we use names that don't collide with real
  // scrapers and only assert on those names.
  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.NSFW_ENABLED;
    } else {
      process.env.NSFW_ENABLED = ORIGINAL;
    }
  });

  it("skips NSFW sources when NSFW_ENABLED is not '1'", () => {
    process.env.NSFW_ENABLED = "0";
    registerSource(fakeSource("fake-nsfw-source-disabled", true));
    expect(getSource("fake-nsfw-source-disabled")).toBeUndefined();
  });

  it("registers NSFW sources when NSFW_ENABLED is '1'", () => {
    process.env.NSFW_ENABLED = "1";
    registerSource(fakeSource("fake-nsfw-source-enabled", true));
    expect(getSource("fake-nsfw-source-enabled")?.isNsfw).toBe(true);
  });

  it("always registers SFW sources regardless of flag", () => {
    process.env.NSFW_ENABLED = "0";
    registerSource(fakeSource("fake-sfw-source-when-disabled", false));
    expect(getSource("fake-sfw-source-when-disabled")?.isNsfw).toBe(false);
  });
});
