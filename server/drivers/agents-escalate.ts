// raise_escalation: the driver side of the harness's escalate endpoint. The
// reason discipline (one line, what the person must decide) is policy that
// lives with the endpoint; this renders its answers for the bot.
import type { HarnessClient, Json } from "./agents-client.ts";

export async function raiseEscalationTool(args: Json, apiResponse: HarnessClient["apiResponse"]): Promise<{ text: string; isError?: boolean }> {
  const reason = args.reason === undefined || args.reason === null ? "" : String(args.reason).trim();
  if (!reason) {
    return { text: 'raise_escalation takes "reason": one line saying what you need from the person and why your work is parked on it. If the person could simply answer you instead, end your turn on the question rather than raising a flag.', isError: true };
  }
  const { ok, status, body: r } = await apiResponse("/api/internal/escalate", { method: "POST", body: JSON.stringify({ reason: reason.slice(0, 500) }) });
  if (!ok) {
    const why = status === 429 ? "This conversation has already raised several escalations in the last hour; the person was told about the first ones. Stop here and wait — do not keep flagging the same gate."
      : String(r.error ?? `HTTP ${status}`);
    return { text: why, isError: true };
  }
  return { text: `Escalated: ${String(r.message ?? "the Chief of Staff (or the person) was told.")}` };
}
