import { describe, expect, it } from "vitest";

import { autonomyShadowDecisionForTool } from "./autonomy-shadow.ts";

describe("autonomy shadow adapter", () => {
  it("stays disabled unless explicitly enabled", () => {
    expect(autonomyShadowDecisionForTool("agent_browser_open", false)).toBeUndefined();
  });

  it("maps trusted runtime tool names without changing the bounded decision", () => {
    expect(autonomyShadowDecisionForTool("agent_browser_open", true)).toEqual({
      action: "navigate",
      decision: { lane: "observe", approval: "auto" },
    });
  });

  it("fails closed for unmapped tool names", () => {
    expect(autonomyShadowDecisionForTool("mcp__unknown__tool", true)).toEqual({
      action: "unknown",
      decision: { lane: "unknown", approval: "ask" },
    });
  });
});
