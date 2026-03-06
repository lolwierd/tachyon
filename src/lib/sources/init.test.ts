import { describe, expect, it } from "vitest";
import { getAllSources, getSource, getNsfwSources, getSfwSources } from "./registry";
import "./init";

describe("source init", () => {
  it("registers all expected sources", () => {
    const all = getAllSources();
    const names = all.map((s) => s.name).sort();
    expect(names).toContain("weebcentral");
    expect(names).toContain("omegascans");
    expect(names).toContain("madaradex");
    expect(names).toContain("toonily");
    expect(names).toContain("oppai");
    expect(names).toContain("manhwa18");
    expect(names).toContain("hentai20");
  });

  it("can retrieve sources by name", () => {
    expect(getSource("weebcentral")).toBeDefined();
    expect(getSource("omegascans")).toBeDefined();
    expect(getSource("madaradex")).toBeDefined();
    expect(getSource("toonily")).toBeDefined();
    expect(getSource("oppai")).toBeDefined();
    expect(getSource("manhwa18")).toBeDefined();
    expect(getSource("hentai20")).toBeDefined();
    expect(getSource("nonexistent")).toBeUndefined();
  });

  it("classifies SFW and NSFW sources correctly", () => {
    const sfw = getSfwSources().map((s) => s.name);
    const nsfw = getNsfwSources().map((s) => s.name);

    expect(sfw).toContain("weebcentral");
    expect(sfw).not.toContain("omegascans");
    expect(sfw).not.toContain("madaradex");
    expect(sfw).not.toContain("toonily");
    expect(sfw).not.toContain("oppai");
    expect(sfw).not.toContain("manhwa18");
    expect(sfw).not.toContain("hentai20");

    expect(nsfw).toContain("omegascans");
    expect(nsfw).toContain("madaradex");
    expect(nsfw).toContain("toonily");
    expect(nsfw).toContain("oppai");
    expect(nsfw).toContain("manhwa18");
    expect(nsfw).toContain("hentai20");
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
    expect(madara.requiresFlareSolverr).toBe(true);

    const toonily = getSource("toonily")!;
    expect(toonily.displayName).toBe("Toonily");
    expect(toonily.baseUrl).toBe("https://toonily.me");
    expect(toonily.isNsfw).toBe(true);

    const oppai = getSource("oppai")!;
    expect(oppai.displayName).toBe("Oppai");
    expect(oppai.baseUrl).toBe("https://read.oppai.stream");
    expect(oppai.isNsfw).toBe(true);

    const manhwa18 = getSource("manhwa18")!;
    expect(manhwa18.displayName).toBe("Manhwa18");
    expect(manhwa18.baseUrl).toBe("https://manhwa18.net");
    expect(manhwa18.isNsfw).toBe(true);

    const hentai20 = getSource("hentai20")!;
    expect(hentai20.displayName).toBe("Hentai20");
    expect(hentai20.baseUrl).toBe("https://hentai20.io");
    expect(hentai20.isNsfw).toBe(true);

    const weeb = getSource("weebcentral")!;
    expect(weeb.displayName).toBe("WeebCentral");
    expect(weeb.isNsfw).toBe(false);
  });
});
