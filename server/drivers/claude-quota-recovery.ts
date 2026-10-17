import { TurnQuotaRefusedError, type RuntimeEvent, type SendTurnInput } from "../contracts.ts";

/** Hold only an initial, zero-usage quota refusal; any work makes automatic replay unsafe. */
export function createClaudeQuotaRecovery(
  publish: (event: RuntimeEvent) => void,
  retire: (threadId: string) => Promise<boolean>,
) {
  type Pending = {
    release: (error?: TurnQuotaRefusedError) => void;
    errors: RuntimeEvent[];
    work: boolean;
    retiring: boolean;
    turnId?: string;
  };
  const pending = new Map<string, Pending>();
  const flush = (state: Pending) => {
    for (const event of state.errors.splice(0)) publish(event);
  };
  const emit = (event: RuntimeEvent, quotaRefusal = false) => {
    const state = pending.get(event.threadId);
    if (!state || state.work) { publish(event); return; }
    if (state.turnId && event.turnId !== state.turnId) { publish(event); return; }
    if (event.type === "turn.started") state.turnId = event.turnId;
    if (state.retiring) return;
    if (event.type === "turn.started" || event.type === "session.started") { publish(event); return; }
    // The driver already classified the native refusal. Its human-readable explanation
    // can change (for example, "has reached its weekly limit"), so never reparse it.
    if (event.type === "runtime.error" && quotaRefusal) {
      state.errors.push(event);
      return;
    }
    if (event.type === "turn.completed" && event.turnId && !event.ok && event.stopReason === "quota" &&
        event.usage?.input === 0 && event.usage.output === 0 && (event.usage.cachedInput ?? 0) === 0 &&
        (event.cost === null || event.cost === 0)) {
      const turnId = event.turnId;
      state.retiring = true;
      void Promise.resolve().then(() => retire(event.threadId)).catch(() => false).then((stopped) => {
        if (stopped) {
          const message = state.errors.find((error) => error.type === "runtime.error");
          state.release(new TurnQuotaRefusedError(turnId, message?.type === "runtime.error" ? message.message : "Claude refused the turn because its quota was exhausted."));
        } else {
          flush(state);
          publish(event);
          state.release();
        }
      });
      return;
    }
    state.work = true;
    flush(state);
    publish(event);
    state.release();
  };
  const run = async (turn: SendTurnInput, dispatch: () => Promise<{ turnId: string }>) => {
    if (!turn.startupRecovery) return dispatch();
    if (pending.has(turn.threadId)) throw new Error("a turn is already starting on this thread");
    let release!: Pending["release"];
    const done = new Promise<TurnQuotaRefusedError | undefined>((resolve) => { release = resolve; });
    const state: Pending = { release, errors: [], work: false, retiring: false };
    pending.set(turn.threadId, state);
    try {
      const ack = await dispatch();
      const error = await done;
      if (error) throw error;
      return ack;
    } finally {
      if (pending.get(turn.threadId) === state) pending.delete(turn.threadId);
    }
  };
  return { emit, run };
}
