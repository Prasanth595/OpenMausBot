import { describe, expect, it } from "vitest";

import { autonomyDecisionForAction } from "./autonomy-gate.ts";

describe("autonomy decision gate", () => {
  it("auto-approves only observe and reversible lanes", () => {
    expect(autonomyDecisionForAction("read")).toEqual({ lane: "observe", approval: "auto" });
    expect(autonomyDecisionForAction("local_test")).toEqual({ lane: "reversible", approval: "auto" });
  });

  it("requires Ask for consequential and unknown actions", () => {
    expect(autonomyDecisionForAction("send")).toEqual({ lane: "consequential", approval: "ask" });
    expect(autonomyDecisionForAction("unknown_action")).toEqual({ lane: "unknown", approval: "ask" });
  });
});
