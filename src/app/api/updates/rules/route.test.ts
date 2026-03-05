import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listUpdateSchedulesMock = vi.fn();
const createUpdateScheduleMock = vi.fn();

vi.mock("@/lib/background/schedules", () => ({
  listUpdateSchedules: listUpdateSchedulesMock,
  createUpdateSchedule: createUpdateScheduleMock,
}));

describe("updates rules API", () => {
  beforeEach(() => {
    listUpdateSchedulesMock.mockReset();
    createUpdateScheduleMock.mockReset();
  });

  it("lists rules", async () => {
    listUpdateSchedulesMock.mockReturnValue([{ id: "rule-1" }]);

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ rules: [{ id: "rule-1" }] });
  });

  it("creates rules", async () => {
    createUpdateScheduleMock.mockReturnValue({ id: "rule-1", name: "Daily" });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/updates/rules", {
        method: "POST",
        body: JSON.stringify({
          name: "Daily",
          targetType: "all",
          intervalMinutes: 60,
          enabled: true,
          targetValue: null,
          jitterSeconds: 10,
        }),
      }),
    );

    expect(createUpdateScheduleMock).toHaveBeenCalledWith({
      name: "Daily",
      enabled: true,
      targetType: "all",
      targetValue: null,
      intervalMinutes: 60,
      jitterSeconds: 10,
    });
    await expect(response.json()).resolves.toEqual({ id: "rule-1", name: "Daily" });
  });

  it("defaults enabled to true when omitted", async () => {
    createUpdateScheduleMock.mockReturnValue({ id: "rule-2", enabled: true });

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/updates/rules", {
        method: "POST",
        body: JSON.stringify({
          name: "Hourly",
          targetType: "smart_unread",
          intervalMinutes: 60,
        }),
      }),
    );

    expect(createUpdateScheduleMock).toHaveBeenCalledWith({
      name: "Hourly",
      enabled: true,
      targetType: "smart_unread",
      targetValue: undefined,
      intervalMinutes: 60,
      jitterSeconds: undefined,
    });
    await expect(response.json()).resolves.toEqual({ id: "rule-2", enabled: true });
  });

  it("validates required payload fields", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("http://localhost/api/updates/rules", {
        method: "POST",
        body: JSON.stringify({ name: "Incomplete" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "name, targetType, and intervalMinutes are required",
    });
  });
});
