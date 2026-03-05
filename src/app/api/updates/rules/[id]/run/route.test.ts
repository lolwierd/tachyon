import { beforeEach, describe, expect, it, vi } from "vitest";

const runUpdateRuleNowMock = vi.fn();

vi.mock("@/lib/background/schedules", () => ({
  runUpdateRuleNow: runUpdateRuleNowMock,
}));

describe("updates rules run-now API", () => {
  beforeEach(() => {
    runUpdateRuleNowMock.mockReset();
  });

  it("runs a rule immediately", async () => {
    runUpdateRuleNowMock.mockReturnValue({ id: "run-1" });

    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/updates/rules/rule-1/run"), {
      params: Promise.resolve({ id: "rule-1" }),
    });

    expect(runUpdateRuleNowMock).toHaveBeenCalledWith("rule-1", "manual");
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      runId: "run-1",
      run: { id: "run-1" },
    });
  });

  it("returns not found when rule does not exist", async () => {
    runUpdateRuleNowMock.mockReturnValue(null);

    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/updates/rules/rule-1/run"), {
      params: Promise.resolve({ id: "rule-1" }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Rule not found" });
  });
});
