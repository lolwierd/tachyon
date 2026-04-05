import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { PUBLIC_APP_HOSTNAME } from "@/lib/network/hosts";
import { middleware } from "./middleware";

const USER_ENV = "TACHYON_BASIC_AUTH_USERNAME";
const PASSWORD_ENV = "TACHYON_BASIC_AUTH_PASSWORD";

function basicAuth(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function makePublicRequest(headers?: HeadersInit) {
  return new NextRequest("https://example.test/library", {
    headers: {
      host: PUBLIC_APP_HOSTNAME,
      "x-forwarded-proto": "https",
      ...headers,
    },
  });
}

describe("middleware public auth", () => {
  afterEach(() => {
    delete process.env[USER_ENV];
    delete process.env[PASSWORD_ENV];
  });

  it("allows trusted private requests without authentication", () => {
    const response = middleware(new NextRequest("http://127.0.0.1/library"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows public requests when auth is not configured", () => {
    const response = middleware(makePublicRequest());
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("returns 401 for public requests without valid credentials", () => {
    process.env[USER_ENV] = "reader";
    process.env[PASSWORD_ENV] = "secret";

    const response = middleware(makePublicRequest());
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Basic realm="Tachyon"');
  });

  it("allows public requests with valid basic auth", () => {
    process.env[USER_ENV] = "reader";
    process.env[PASSWORD_ENV] = "secret";

    const response = middleware(makePublicRequest({
      authorization: basicAuth("reader", "secret"),
    }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not trust spoofed private-routing headers on public requests", () => {
    process.env[USER_ENV] = "reader";
    process.env[PASSWORD_ENV] = "secret";

    const response = middleware(makePublicRequest({
      "x-forwarded-host": "tachyon-ts.lolwierd.com",
      "x-tachyon-route": "tailscale",
    }));

    expect(response.status).toBe(401);
  });
});
