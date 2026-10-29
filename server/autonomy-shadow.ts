import { autonomyDecisionForAction, type AutonomyDecision } from "./autonomy-gate.ts";

const TOOL_ACTIONS = new Map<string, string>([
  ["agent_browser_open", "navigate"],
  ["browser_open", "navigate"],
  ["open_url", "navigate"],
  ["agent_browser_get_text", "read"],
  ["browser_get_text", "read"],
  ["read_file", "read"],
  ["agent_browser_screenshot", "screenshot"],
  ["browser_screenshot", "screenshot"],
  ["screenshot", "screenshot"],
]);

export interface AutonomyShadowDecision {
  action: string;
  decision: AutonomyDecision;
}

/**
 * Observe the bounded autonomy classification without changing approval behavior.
 * The caller must keep this disabled unless the explicit shadow flag is enabled.
 */
export function autonomyShadowDecisionForTool(
  tool: string,
  enabled = process.env.OPENMAUS_AUTONOMY_SHADOW === "1",
): AutonomyShadowDecision | undefined {
  if (!enabled) return undefined;
  const normalized = tool.trim().toLowerCase();
  const action = TOOL_ACTIONS.get(normalized) ?? "unknown";
  return { action, decision: autonomyDecisionForAction(action) };
}
