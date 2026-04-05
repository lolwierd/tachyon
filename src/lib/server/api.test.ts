import { ApiError, assertTrustedWriteRequest, parseJsonBody } from "@/lib/server/api";
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("server api helpers", () => {
  it("allows same-origin write requests", () => {
    expect(() =>
      assertTrustedWriteRequest(new Request("http://localhost/api/library", {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "sec-fetch-site": "same-origin",
        },
      }))).not.toThrow();
  });

  it("rejects cross-site write requests", () => {
    expect(() =>
      assertTrustedWriteRequest(new Request("http://localhost/api/library", {
        method: "POST",
        headers: {
          origin: "https://evil.test",
        },
      }))).toThrowError(ApiError);
  });

  it("parses validated JSON bodies", async () => {
    const body = await parseJsonBody(
      new Request("http://localhost/api/reader/state", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ seriesId: "series-1" }),
      }),
      z.object({ seriesId: z.string().min(1) }),
    );

    expect(body).toEqual({ seriesId: "series-1" });
  });

  it("rejects JSON bodies without the expected content type", async () => {
    await expect(
      parseJsonBody(
        new Request("http://localhost/api/reader/state", {
          method: "POST",
          body: JSON.stringify({ seriesId: "series-1" }),
        }),
        z.object({ seriesId: z.string().min(1) }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid_content_type",
    });
  });
});
