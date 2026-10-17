import { describe, expect, it, vi } from "vitest";
import { TurnQuotaRefusedError, type RuntimeEvent } from "../contracts.ts";
import { createClaudeQuotaRecovery } from "./claude-quota-recovery.ts";

const base = { eventId: "event", provider: "claudeAgent", threadId: "thread", turnId: "turn", createdAt: new Date().toISOString() };
const started: RuntimeEvent = { ...base, type: "turn.started" };
const error: RuntimeEvent = { ...base, type: "runtime.error", message: "This Claude account has reached its weekly limit, which resets Oct 20, 10:00 PM (America/New_York). Until then, switch this bot to another engine or Claude account." };
const quota: RuntimeEvent = { ...base, type: "turn.completed", ok: false, stopReason: "quota", cost: 0, usage: { input: 0, output: 0 } };

function fixture(retire = vi.fn(async () => true)) {
  const events: RuntimeEvent[] = [];
  const recovery = createClaudeQuotaRecovery(event => events.push(event), retire);
  const run = (extra = {}) => recovery.run({ threadId: "thread", text: "hello", startupRecovery: true, ...extra }, async () => {
    recovery.emit(started);
    return { turnId: "turn" };
  });
  return { ...recovery, run, events, retire };
}

describe("Claude initial quota recovery", () => {
  it("rejects only after the refused process is confirmed stopped, without publishing a failed completion", async () => {
    let stopped!: (value: boolean) => void;
    const f = fixture(vi.fn(() => new Promise<boolean>(resolve => { stopped = resolve; })));
    const result = f.run().catch(e => e);
    f.emit(error, true); f.emit(quota);
    await vi.waitFor(() => expect(f.retire).toHaveBeenCalledOnce());
    expect(f.events).toEqual([started]);
    stopped(true);
    expect(await result).toBeInstanceOf(TurnQuotaRefusedError);
    expect(f.events).toEqual([started]);
  });

  it.each([false, "throw"])("keeps the quota error when process cleanup fails: %s", async (outcome) => {
    const f = fixture(vi.fn(async () => { if (outcome === "throw") throw new Error("cleanup failed"); return false; }));
    const result = f.run(); f.emit(error, true); f.emit(quota);
    expect(await result).toEqual({ turnId: "turn" });
    expect(f.events).toEqual([started, error, quota]);
  });

  it.each([
    { ...base, type: "content.delta", streamKind: "assistant_text", delta: "working" },
    { ...base, type: "item.started", itemId: "tool", itemType: "tool", title: "Bash" },
    { ...base, type: "thread.token-usage.updated", input: 1, output: 0 },
    { ...base, type: "runtime.error", message: "authentication failed" },
  ] as RuntimeEvent[])("never replays after $type", async (work) => {
    const f = fixture(); const result = f.run(); f.emit(work); f.emit(error, true); f.emit(quota);
    expect(await result).toEqual({ turnId: "turn" });
    expect(f.retire).not.toHaveBeenCalled();
    expect(f.events).toEqual([started, work, error, quota]);
  });

  it.each([
    { usage: undefined }, { usage: { input: 1, output: 0 } }, { usage: { input: 0, output: 1 } },
    { usage: { input: 0, output: 0, cachedInput: 1 } }, { cost: 0.01 },
    { stopReason: "interrupted" }, { stopReason: "auth_required" }, { stopReason: "safety" }, { ok: true },
  ])("does not infer a safe refusal from an error string: %j", async (change) => {
    const f = fixture(); const result = f.run(); f.emit(error, true); const completion = { ...quota, ...change } as RuntimeEvent; f.emit(completion);
    expect(await result).toEqual({ turnId: "turn" });
    expect(f.retire).not.toHaveBeenCalled();
    expect(f.events).toEqual([started, error, completion]);
  });

  it("leaves recovery-disabled dispatch unchanged", async () => {
    const f = fixture(); await f.run({ startupRecovery: false }); f.emit(error, true); f.emit(quota);
    expect(f.retire).not.toHaveBeenCalled(); expect(f.events).toEqual([started, error, quota]);
  });
});
