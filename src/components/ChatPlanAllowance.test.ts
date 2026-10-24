import { describe, expect, it } from "vitest";
import { chatPlanAllowance, contextAllowanceLabel } from "./ChatPlanAllowance";

const bot = { instanceId: "chief-claude" };

describe("chatPlanAllowance", () => {
  it("uses the active bot's subscription account only", () => {
    expect(chatPlanAllowance(bot, { providers: [
      { id: "other", name: "Other", ok: true, fiveHour: { available: true, remainingPercent: 10, usedPercent: 90, resetsAt: null } },
      { id: "chief-claude", name: "Claude", ok: true, fiveHour: { available: true, remainingPercent: 34, usedPercent: 66, resetsAt: "2026-10-22T16:00:00.000Z" } },
    ] })).toEqual({ name: "Claude", available: true, remainingPercent: 34, usedPercent: 66, resetsAt: "2026-10-22T16:00:00.000Z" });
  });

  it("keeps an unavailable provider visible instead of inventing a percentage", () => {
    expect(chatPlanAllowance(bot, { providers: [
      { id: "chief-claude", name: "Claude", ok: false, fiveHour: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null } },
    ] })).toMatchObject({ name: "Claude", available: false, remainingPercent: null });
  });

  it("labels the current thread context without treating it as total usage", () => {
    expect(contextAllowanceLabel({ input: 0, output: 0, costUsd: null, turns: 0, context: { tokens: 126_400 } })).toBe("ctx 126k");
    expect(contextAllowanceLabel({ input: 0, output: 0, costUsd: null, turns: 0 })).toBeNull();
  });
});
