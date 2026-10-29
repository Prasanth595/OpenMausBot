import { autonomyLaneForAction, type AutonomyLane } from "./autonomy-policy.ts";

export interface AutonomyDecision {
  lane: AutonomyLane;
  approval: "auto" | "ask";
}

/** Convert a classified action into the bounded approval lane. Unknown is fail-closed. */
export function autonomyDecisionForAction(action: string): AutonomyDecision {
  const lane = autonomyLaneForAction(action);
  return {
    lane,
    approval: lane === "observe" || lane === "reversible" ? "auto" : "ask",
  };
}
