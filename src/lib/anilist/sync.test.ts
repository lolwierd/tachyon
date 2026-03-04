import { describe, expect, it } from "vitest";
import { resolveAniListSyncDecision } from "./sync";

describe("resolveAniListSyncDecision", () => {
  it("pushes local changes when remote has not changed since the last sync", () => {
    const decision = resolveAniListSyncDecision({
      localStatus: "reading",
      localStatusUpdatedAt: new Date("2026-03-04T10:00:00.000Z"),
      localProgress: 12,
      localProgressUpdatedAt: new Date("2026-03-04T10:00:00.000Z"),
      remoteStatus: "CURRENT",
      remoteProgress: 10,
      remoteUpdatedAt: new Date("2026-03-03T10:00:00.000Z"),
      lastSyncedAt: new Date("2026-03-03T12:00:00.000Z"),
    });

    expect(decision).toEqual({
      direction: "push",
      status: "CURRENT",
      progress: 12,
      hasConflict: false,
    });
  });

  it("pulls remote changes when local state is stale", () => {
    const decision = resolveAniListSyncDecision({
      localStatus: "planning",
      localStatusUpdatedAt: new Date("2026-03-02T10:00:00.000Z"),
      localProgress: 0,
      localProgressUpdatedAt: new Date("2026-03-02T10:00:00.000Z"),
      remoteStatus: "CURRENT",
      remoteProgress: 4,
      remoteUpdatedAt: new Date("2026-03-04T10:00:00.000Z"),
      lastSyncedAt: new Date("2026-03-03T12:00:00.000Z"),
    });

    expect(decision).toEqual({
      direction: "pull",
      status: "CURRENT",
      progress: 4,
      hasConflict: false,
    });
  });

  it("merges divergent progress and marks the result as a conflict", () => {
    const decision = resolveAniListSyncDecision({
      localStatus: "reading",
      localStatusUpdatedAt: new Date("2026-03-04T09:30:00.000Z"),
      localProgress: 16,
      localProgressUpdatedAt: new Date("2026-03-04T09:30:00.000Z"),
      remoteStatus: "PAUSED",
      remoteProgress: 14,
      remoteUpdatedAt: new Date("2026-03-04T09:00:00.000Z"),
      lastSyncedAt: new Date("2026-03-03T12:00:00.000Z"),
    });

    expect(decision).toEqual({
      direction: "merge",
      status: "CURRENT",
      progress: 16,
      hasConflict: true,
    });
  });
});
