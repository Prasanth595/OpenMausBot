// assignment_status: reads one assignment, or the conversation's outstanding
// list, off the harness's internal endpoint and renders it in the bot's words.
// Moved out of agents-call.ts when the file-size ratchet closed; the bodies
// are unchanged.
import { peerName } from "../peer-roster.ts";
import type { HarnessClient, Json } from "./agents-client.ts";
const STATUS_WORDS: Record<string, string> = {
  queued: "queued, not started yet",
  running: "running",
  needs_input: "waiting on the person",
  waiting: "waiting on its own hand-offs",
  resume: "wrapping up (its hand-offs settled)",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};
const RESULT_HEAD = 2_000;

export function jsonRecord(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assignmentLine(a: Json): string {
  const id = typeof a.id === "string" && a.id ? a.id : "?";
  const who = typeof a.botName === "string" && a.botName ? `@${peerName(a.botName)}`
    : typeof a.botId === "string" && a.botId ? a.botId : "a teammate";
  const status = String(a.status ?? "unknown");
  const outcome = typeof a.outcome === "string" && a.outcome && a.outcome !== "done" && a.outcome !== status ? ` (${a.outcome})` : "";
  const detail = typeof a.outcomeDetail === "string" && a.outcomeDetail.trim() ? `: ${a.outcomeDetail.trim()}` : "";
  return `${id} → ${who}: ${STATUS_WORDS[status] ?? status}${outcome}${detail}`;
}

function renderAssignmentStatus(r: Json, id: string): string {
  const raw = jsonRecord(r.assignment) ? r.assignment : r;
  const a: Json = { id, ...raw, botName: raw.botName ?? r.toBotName };
  const lines = [`Assignment ${assignmentLine(a)}`];
  const question = typeof a.question === "string" ? a.question.trim() : "";
  if (question && (a.status === "needs_input" || a.outcome === "needs_input")) {
    lines.push(`It is parked on a question for the person: ${JSON.stringify(question)}. Nothing moves until the person answers it in that thread; tell them and do not keep checking.`);
  }
  const result = typeof a.result === "string" ? a.result.trim() : "";
  if (result) lines.push(`Result${result.length > RESULT_HEAD ? " (first part)" : ""}: ${result.slice(0, RESULT_HEAD)}`);
  const children = Array.isArray(r.children) ? r.children.filter(jsonRecord) : [];
  if (children.length) lines.push("Its own hand-offs:", ...children.map((child) => `- ${assignmentLine(child)}`));
  const settled = a.status === "completed" || a.status === "failed" || a.status === "cancelled" || a.status === "done";
  if (!settled) lines.push("It is not settled. Its result resumes you on its own; do not wait on it in this turn.");
  return lines.join("\n");
}

export async function assignmentStatusTool(args: Json, apiResponse: HarnessClient["apiResponse"]): Promise<{ text: string; isError?: boolean }> {
  const id = args.id === undefined || args.id === null || args.id === "" ? "" : String(args.id).trim();
  if (id && !/^[\w-]{4,64}$/.test(id)) {
    return { text: 'assignment_status takes an optional "id" (the assignment id from a coordinate_bots receipt or list_threads) and an optional "wait_ms" (0-240000). Omit id to list every outstanding assignment of this conversation.', isError: true };
  }
  if (args.wait_ms !== undefined && (typeof args.wait_ms !== "number" || !Number.isFinite(args.wait_ms) || args.wait_ms < 0)) {
    return { text: "assignment_status wait_ms must be a whole number of milliseconds from 0 to 240000.", isError: true };
  }
  const waitMs = Math.min(Math.trunc(Number(args.wait_ms) || 0), 240_000);
  const query = new URLSearchParams();
  if (id) query.set("id", id);
  if (waitMs > 0) query.set("wait_ms", String(waitMs));
  const { ok, status, body: r } = await apiResponse(`/api/internal/assignment-status${query.size ? `?${query.toString()}` : ""}`);
  if (!ok) {
    const why = status === 404 ? `No assignment ${id || "(none given)"} is known here: check the id against your coordinate_bots receipt or list_threads.`
      : status === 403 ? `Assignment ${id} is not this conversation's; only its requester can read it.`
      : String(r.error ?? `HTTP ${status}`);
    return { text: why, isError: true };
  }
  if (id) return { text: renderAssignmentStatus(r, id) };
  const outstanding = Array.isArray(r.outstanding) ? r.outstanding.filter(jsonRecord) : [];
  if (!outstanding.length) return { text: "Nothing outstanding: no assignment of this conversation is still open." };
  return {
    text: `Outstanding assignments of this conversation (${outstanding.length}):\n${outstanding.map((a) => `- ${assignmentLine(a)}`).join("\n")}\nEach resumes you when it settles; do not wait on them in this turn.`,
  };
}
