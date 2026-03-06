import { describe, expect, it } from "vitest";
import { getAllSources, getSource, getNsfwSources, getSfwSources } from "./registry";
import "./init";

describe("source init", () => {
  it("registers all three sources", () => {
    const all = getAllSources();
    const names = all.map((s) => s.name).sort();
    expect(names).toContain("weebcentral");
    expect(names).toContain("omegascans");
    expect(names).toContain("madaradex");
  });

  it("can retrieve sources by name", () => {
    expect(getSource("weebcentral")).toBeDefined();
    expect(getSource("omegascans")).toBeDefined();
    expect(getSource("madaradex")).toBeDefined();
    expect(getSource("nonexistent")).toBeUndefined();
  });

  it("classifies SFW and NSFW sources correctly", () => {
    const sfw = getSfwSources().map((s) => s.name);
    const nsfw = getNsfwSources().map((s) => s.name);

    expect(sfw).toContain("weebcentral");
    expect(sfw).not.toContain("omegascans");
    expect(sfw).not.toContain("madaradex");

    expect(nsfw).toContain("omegascans");
    expect(nsfw).toContain("madaradex");
    expect(nsfw).not.toContain("weebcentral");
  });

  it("sources have correct metadata", () => {
    const omega = getSource("omegascans")!;
    expect(omega.displayName).toBe("OmegaScans");
    expect(omega.baseUrl).toBe("https://omegascans.org");
    expect(omega.isNsfw).toBe(true);

    const madara = getSource("madaradex")!;
    expect(madara.displayName).toBe("MadaraDex");
    expect(madara.baseUrl).toBe("https://madaradex.org");
    expect(madara.isNsfw).toBe(true);

    const weeb = getSource("weebcentral")!;
    expect(weeb.displayName).toBe("WeebCentral");
    expect(weeb.isNsfw).toBe(false);
  });
});
