import { describe, expect, it } from "vitest";
import {
  PRIVATE_APP_HOSTNAME,
  PUBLIC_APP_HOSTNAME,
  buildHostSwitchUrl,
  isPrivateHost,
  isPublicHost,
} from "./client";

describe("network client helpers", () => {
  it("builds a same-path switch URL on another host", () => {
    expect(
      buildHostSwitchUrl(
        "https://tachyon.lolwierd.com/read/foo/bar?page=3#images",
        PRIVATE_APP_HOSTNAME,
      ),
    ).toBe("https://tachyon-ts.lolwierd.com/read/foo/bar?page=3#images");
  });

  it("identifies the public and private hostnames", () => {
    expect(isPublicHost(PUBLIC_APP_HOSTNAME)).toBe(true);
    expect(isPrivateHost(PRIVATE_APP_HOSTNAME)).toBe(true);
    expect(isPublicHost(PRIVATE_APP_HOSTNAME)).toBe(false);
    expect(isPrivateHost(PUBLIC_APP_HOSTNAME)).toBe(false);
  });
});
