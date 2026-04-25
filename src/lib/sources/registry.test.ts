import { afterEach, describe, expect, it } from "vitest";

import { getExtraSources, getMainSources, getSource, registerSource } from "./registry";

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

describe("getMainSources / getExtraSources NSFW collapse", () => {
  // Covers the belt-and-suspenders `effectiveNsfw = nsfw && isNsfwEnabled()`
  // path: even when a caller passes nsfw=true (e.g. a stale request that
  // slipped past the route-level coercion), the registry must not hand
  // back NSFW sources when the global kill switch is off.
  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.NSFW_ENABLED;
    } else {
      process.env.NSFW_ENABLED = ORIGINAL;
    }
  });

  it("filters NSFW sources out of getExtraSources when flag is off, even if caller asks for nsfw=true", () => {
    // Register while enabled so the source lands in the map, then flip
    // the flag and confirm the getter still hides it.
    process.env.NSFW_ENABLED = "1";
    registerSource(fakeSource("fake-extra-nsfw-collapse", true));
    expect(getSource("fake-extra-nsfw-collapse")?.isNsfw).toBe(true);

    process.env.NSFW_ENABLED = "0";
    const extra = getExtraSources(true);
    expect(extra.find((s) => s.name === "fake-extra-nsfw-collapse")).toBeUndefined();
  });

  it("returns NSFW extras when both flag and arg are true", () => {
    process.env.NSFW_ENABLED = "1";
    registerSource(fakeSource("fake-extra-nsfw-enabled", true));
    const extra = getExtraSources(true);
    expect(extra.find((s) => s.name === "fake-extra-nsfw-enabled")?.isNsfw).toBe(true);
  });

  it("getMainSources never returns NSFW when flag is off", () => {
    process.env.NSFW_ENABLED = "0";
    // getMainSources is gated by a hardcoded MAIN_* set, so we don't
    // bother registering fakes here — asserting the invariant across
    // whatever is currently registered is enough.
    expect(getMainSources(true).every((s) => !s.isNsfw)).toBe(true);
    expect(getMainSources(false).every((s) => !s.isNsfw)).toBe(true);
  });
});
