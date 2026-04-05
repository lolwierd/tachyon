import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

describe("network path API", () => {
  it("returns tailscale for the private hostname", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("https://tachyon-ts.lolwierd.com/api/network/path", {
      headers: {
        host: "tachyon-ts.lolwierd.com",
        "x-forwarded-proto": "https",
      },
    }));

    await expect(response.json()).resolves.toEqual({
      route: "tailscale",
      host: "tachyon-ts.lolwierd.com",
      scheme: "https",
    });
  });

  it("returns cloudflare when Cloudflare headers are present", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("https://tachyon.lolwierd.com/api/network/path", {
      headers: {
        host: "tachyon.lolwierd.com",
        "cf-ray": "abc123",
      },
    }));

    await expect(response.json()).resolves.toEqual({
      route: "cloudflare",
      host: "tachyon.lolwierd.com",
      scheme: "https",
    });
  });
});
