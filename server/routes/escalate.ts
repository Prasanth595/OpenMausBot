// raise_escalation: a bot parks itself on a gate only a person can lift and
// says so (server/escalations.ts). The flag does not interrupt the turn —
// the bot still owns its reply — so the answer tells it to finish what it
// can and wait; the Chief's (or the person's) notice is the deliverable,
// and a Chief's own flag is the person's to hear. The capability bearer is
// checked here, as every /api/internal handler does its own.
import { PASS, type RouteHandler } from "./table.ts";
import { RAISED_GATE, type EscalationKind } from "../escalations.ts";

export interface EscalateRoutesDeps<C extends { botId: string; threadId: string; kind: string }, B> {
  authorize: (header: string | string[] | undefined) => C | null;
  isActive: (capability: C) => boolean;
  /** True when this capability is an external runtime that may not call here. */
  externalBlocked: (capability: C, method: string, path: string) => boolean;
  bot: (id: string) => B | undefined;
  reportEscalation: (input: { kind: EscalationKind; bot: B; threadId: string; gate: string; reason: string; alreadyNotified: boolean }) => "chief" | "person" | "muted";
}

export function createEscalateRoutes<C extends { botId: string; threadId: string; kind: string }, B>(deps: EscalateRoutesDeps<C, B>): RouteHandler {
  return async (ctx) => {
    if (ctx.method !== "POST" || ctx.path !== "/api/internal/escalate") return PASS;
    const capability = deps.authorize(ctx.req.headers.authorization);
    if (!capability) return ctx.json(ctx.res, 401, { error: "unauthorized" });
    const sender = deps.bot(capability.botId);
    if (!sender) return ctx.json(ctx.res, 401, { error: "unauthorized" });
    if (deps.externalBlocked(capability, ctx.method, ctx.path)) {
      return ctx.json(ctx.res, 403, { error: "an external runtime can only list its peers, hand them work with coordinate_bots and read assignment_status" });
    }
    if (capability.kind !== "agents") {
      return ctx.json(ctx.res, 403, { error: "this internal capability cannot access that service" });
    }
    const body = await ctx.readBody(ctx.req);
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!reason) {
      return ctx.json(ctx.res, 400, { error: "raise_escalation needs reason: one line saying what you need from the person and why your work is parked on it" });
    }
    if (!deps.isActive(capability)) {
      return ctx.json(ctx.res, 401, { error: "the internal turn capability has expired" });
    }
    const outcome = deps.reportEscalation({
      kind: "raised",
      bot: sender,
      threadId: capability.threadId,
      gate: RAISED_GATE,
      reason,
      alreadyNotified: false,
    });
    if (outcome === "muted") {
      return ctx.json(ctx.res, 429, { error: "this conversation has already raised several escalations in the last hour; the person was told about the first ones. Finish your turn and wait — do not keep flagging the same gate." });
    }
    return ctx.json(ctx.res, 200, {
      escalated: true,
      message: outcome === "chief"
        ? "your Chief of Staff was told in its Team escalations thread. Say plainly that you stopped at this gate and why, then end your turn and wait; do not retry the gated work until the person lifts the gate."
        : "the person was told directly. Say plainly that you stopped at this gate and why, then end your turn and wait; do not retry the gated work until the person lifts the gate.",
    });
  };
}
