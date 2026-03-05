import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUpdateScheduleMock = vi.fn();
const patchUpdateScheduleMock = vi.fn();
const deleteUpdateScheduleMock = vi.fn();

vi.mock("@/lib/background/schedules", () => ({
  getUpdateSchedule: getUpdateScheduleMock,
  patchUpdateSchedule: patchUpdateScheduleMock,
  deleteUpdateSchedule: deleteUpdateScheduleMock,
}));

describe("updates rules by id API", () => {
  beforeEach(() => {
    getUpdateScheduleMock.mockReset();
    patchUpdateScheduleMock.mockReset();
    deleteUpdateScheduleMock.mockReset();
  });

  it("patches a rule", async () => {
    patchUpdateScheduleMock.mockReturnValue({ id: "rule-1", name: "Hourly" });

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest("http://localhost/api/updates/rules/rule-1", {
        method: "PATCH",
        body: JSON.stringify({
          name: "Hourly",
          enabled: true,
          intervalMinutes: 60,
        }),
      }),
      { params: Promise.resolve({ id: "rule-1" }) },
    );

    expect(patchUpdateScheduleMock).toHaveBeenCalledWith("rule-1", {
      name: "Hourly",
      enabled: true,
      targetType: undefined,
      targetValue: undefined,
      intervalMinutes: 60,
      jitterSeconds: undefined,
    });
    await expect(response.json()).resolves.toEqual({ id: "rule-1", name: "Hourly" });
  });

  it("returns not found when patch target is missing", async () => {
    patchUpdateScheduleMock.mockReturnValue(null);

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new NextRequest("http://localhost/api/updates/rules/rule-1", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      }),
      { params: Promise.resolve({ id: "rule-1" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Rule not found" });
  });

  it("deletes an existing rule", async () => {
    getUpdateScheduleMock.mockReturnValue({ id: "rule-1" });

    const { DELETE } = await import("./route");
    const response = await DELETE(new Request("http://localhost/api/updates/rules/rule-1"), {
      params: Promise.resolve({ id: "rule-1" }),
    });

    expect(deleteUpdateScheduleMock).toHaveBeenCalledWith("rule-1");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("returns not found on delete when rule is missing", async () => {
    getUpdateScheduleMock.mockReturnValue(null);

    const { DELETE } = await import("./route");
    const response = await DELETE(new Request("http://localhost/api/updates/rules/rule-1"), {
      params: Promise.resolve({ id: "rule-1" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Rule not found" });
  });
});
