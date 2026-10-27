import { newId, type RuntimeEvent } from "../contracts.ts";
import { resolveStep, type ComputerCaller } from "./resolve.ts";
import { stepLabel, type Recipe } from "./rules.ts";

export interface ReplayTurn { threadId: string; turnId: string; provider: string; providerInstanceId: string }
export interface StepApproval { ask(tool: string, summary: string): Promise<boolean> }
export type ReplayOutcome =
  | { kind: "done" }
  | { kind: "declined"; tool: string; label: string }
  | { kind: "failed"; done: number; total: number; tool: string; label: string; error: string }
  | { kind: "stopped" };

const STOPPED: ReplayOutcome = { kind: "stopped" };
const engineToolName = (tool: string) => `mcp__computer__${tool}`;
const stepSummary = (tool: string, label: string) => `${tool} on ${label}`;

export async function runSteps(
  recipe: Recipe,
  turn: ReplayTurn,
  deps: { caller: ComputerCaller; approval: StepApproval; publish(event: RuntimeEvent): void; signal: AbortSignal },
): Promise<ReplayOutcome> {
  const { caller, approval, publish, signal } = deps;
  const total = recipe.steps.length;
  const base = (itemId: string) => ({
    eventId: newId(), createdAt: new Date().toISOString(), itemId,
    threadId: turn.threadId, turnId: turn.turnId, provider: turn.provider, providerInstanceId: turn.providerInstanceId,
  });
  for (const [done, step] of recipe.steps.entries()) {
    if (signal.aborted) return STOPPED;
    const label = stepLabel(step);
    const failed = (error: string): ReplayOutcome => (signal.aborted ? STOPPED : { kind: "failed", done, total, tool: step.tool, label, error });
    const target = await resolveStep(step, caller, signal);
    if (!target.ok) return failed(target.error);
    const tool = engineToolName(step.tool);
    const summary = stepSummary(step.tool, label);
    const allowed = await approval.ask(tool, summary);
    if (signal.aborted) return STOPPED;
    if (!allowed) return { kind: "declined", tool: step.tool, label };
    const itemId = newId();
    publish({ ...base(itemId), type: "item.started", itemType: "tool", title: tool, input: summary });
    const result = await caller.call(step.tool, target.args, signal);
    publish({ ...base(itemId), type: "item.completed", itemType: "tool", ok: result.ok, output: result.ok ? "done" : result.error });
    if (!result.ok) return failed(result.error);
  }
  return { kind: "done" };
}

export function fallbackNote(outcome: Extract<ReplayOutcome, { kind: "failed" }>): string {
  const { done, total, tool, label } = outcome;
  const progress = done === 0 ? `failed at step 1 of ${total}` : `did steps 1–${done} of ${total} and failed at step ${done + 1}`;
  const error = outcome.error.replace(/[.\s]+$/u, "");
  return `A saved run of this request ${progress} (${stepSummary(tool, label)}): ${error}. The screen may already be partly changed; look before acting.`;
}

export function declinedReply(outcome: Extract<ReplayOutcome, { kind: "declined" }>): string {
  return `I stopped repeating the saved steps: ${stepSummary(outcome.tool, outcome.label)} was declined.`;
}
