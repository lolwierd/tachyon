import { describe, expect, it } from "vitest";
import { detectNetworkPath } from "./path";

describe("detectNetworkPath", () => {
  it("identifies tailscale traffic from the private hostname", () => {
    const headers = new Headers({
      host: "tachyon-ts.lolwierd.com",
      "x-forwarded-proto": "https",
    });

    expect(detectNetworkPath(headers)).toEqual({
      route: "tailscale",
      host: "tachyon-ts.lolwierd.com",
      scheme: "https",
    });
  });

  it("identifies cloudflare traffic from Cloudflare headers", () => {
    const headers = new Headers({
      host: "tachyon.lolwierd.com",
      "cf-ray": "abc123",
      "cf-connecting-ip": "203.0.113.9",
    });

    expect(detectNetworkPath(headers)).toEqual({
      route: "cloudflare",
      host: "tachyon.lolwierd.com",
      scheme: "https",
    });
  });

  it("falls back to direct for local traffic", () => {
    const headers = new Headers({
      host: "127.0.0.1:3000",
      "x-forwarded-proto": "http",
    });

    expect(detectNetworkPath(headers)).toEqual({
      route: "direct",
      host: "127.0.0.1:3000",
      scheme: "http",
    });
  });

  it("ignores spoofed forwarding headers when classifying traffic", () => {
    const headers = new Headers({
      host: "tachyon.lolwierd.com",
      "x-forwarded-host": "tachyon-ts.lolwierd.com",
      "x-tachyon-route": "tailscale",
    });

    expect(detectNetworkPath(headers)).toEqual({
      route: "direct",
      host: "tachyon.lolwierd.com",
      scheme: null,
    });
  });
});
