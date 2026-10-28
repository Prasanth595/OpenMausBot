import { beforeEach, describe, expect, it } from "vitest";
import type { RuntimeEvent } from "../contracts.ts";
import { completeWindowState, windowState } from "../testing/saved-steps-fixtures.ts";
import { declinedReply, fallbackNote, runSteps, type ReplayTurn, type StepApproval } from "./replay.ts";
import type { CallOutcome, ComputerCaller } from "./resolve.ts";
import type { Recipe, RecipeStep } from "./rules.ts";

const TARGET: Pick<RecipeStep, "app" | "window" | "element"> = {
  app: { bundleId: "com.apple.TextEdit", name: "TextEdit" },
  window: { title: "Untitled" },
  element: { role: "AXTextArea", label: "Document", path: ["AXScrollArea:"] },
};
const RECIPE: Recipe = {
  id: "r1", key: "open textedit and type hello world", request: "Open TextEdit and type hello world", reply: "Typed hello world into TextEdit.",
  createdAt: 1_000, lastUsedAt: 1_000, steps: [{ tool: "click", args: {}, ...TARGET }, { tool: "type_text", args: { text: "hello world" }, ...TARGET }],
};
const TURN: ReplayTurn = { threadId: "t1", turnId: "turn-1", provider: "claudeAgent", providerInstanceId: "claude" };
const OBSERVATIONS = new Set(["list_apps", "list_windows", "get_window_state"]);

let acted: [string, Record<string, unknown>][];
let asked: [string, string][];
let events: RuntimeEvent[];
let deps: Parameters<typeof runSteps>[2];

function computer(answer: (tool: string) => CallOutcome | undefined = () => undefined): ComputerCaller {
  let snapshot = 2;
  return {
    async call(tool, args) {
      const override = answer(tool);
      if (override) return override;
      if (tool === "list_apps") return { ok: true, structured: { apps: [{ pid: 4242, name: "TextEdit", bundle_id: "com.apple.TextEdit", running: true }] } };
      if (tool === "list_windows") return { ok: true, structured: { windows: [{ window_id: 7, pid: 4242, title: "Untitled", app_name: "TextEdit" }] } };
      if (tool === "get_window_state") return { ok: true, structured: completeWindowState(windowState(snapshot++)) };
      if (OBSERVATIONS.has(tool)) throw new Error(`unexpected ${tool}`);
      acted.push([tool, args]);
      return { ok: true, structured: {} };
    },
  };
}

const failing = (tool: string, error: string) => computer((called) => (called === tool ? { ok: false, error } : undefined));
const approveAll: StepApproval = { async ask(tool, summary) { asked.push([tool, summary]); return true; } };
const denyAt = (step: number): StepApproval => ({ async ask(tool, summary) { asked.push([tool, summary]); return asked.length !== step; } });
const itemEvents = () => events.map((e) => [e.type, e.turnId, "ok" in e ? e.ok : undefined]);

beforeEach(() => {
  acted = [];
  asked = [];
  events = [];
  deps = { caller: computer(), approval: approveAll, publish: (event) => events.push(event), signal: new AbortController().signal };
});

describe("runSteps", () => {
  it("asks once per action, resolves afresh and reports each step", async () => {
    expect(await runSteps(RECIPE, TURN, deps)).toEqual({ kind: "done" });
    expect(asked).toEqual([["mcp__computer__click", 'click on "Document" in TextEdit'], ["mcp__computer__type_text", 'type_text "hello world" on "Document" in TextEdit']]);
    expect(acted).toEqual([["click", { pid: 4242, window_id: 7, element_token: "s2-e2" }], ["type_text", { text: "hello world", pid: 4242, window_id: 7, element_token: "s3-e2" }]]);
    expect(itemEvents()).toEqual([
      ["item.started", "turn-1", undefined], ["item.completed", "turn-1", true], ["item.started", "turn-1", undefined], ["item.completed", "turn-1", true]]);
  });

  it("words each approval with what the step types or presses", async () => {
    const keys: Recipe = { ...RECIPE, steps: [
      { tool: "set_value", args: { value: "hello" }, ...TARGET },
      { tool: "press_key", args: { key: "s", modifiers: ["cmd"] }, app: TARGET.app },
      { tool: "press_key", args: { key: "return" }, app: TARGET.app },
      { tool: "hotkey", args: { keys: ["cmd", "shift", "s"] }, app: TARGET.app },
    ] };
    expect(await runSteps(keys, TURN, deps)).toEqual({ kind: "done" });
    expect(asked).toEqual([
      ["mcp__computer__set_value", 'set_value "hello" on "Document" in TextEdit'],
      ["mcp__computer__press_key", 'press_key "cmd+s" on TextEdit'],
      ["mcp__computer__press_key", 'press_key "return" on TextEdit'],
      ["mcp__computer__hotkey", 'hotkey "cmd+shift+s" on TextEdit'],
    ]);
    expect(events.filter((e) => e.type === "item.started").map((e) => "input" in e && e.input))
      .toEqual(['set_value on "Document" in TextEdit', "press_key on TextEdit", "press_key on TextEdit", "hotkey on TextEdit"]);
  });

  it("tells each step's item who ran it and what it did", async () => {
    await runSteps(RECIPE, TURN, deps);
    const turn = { threadId: "t1", turnId: "turn-1", provider: "claudeAgent", providerInstanceId: "claude" };
    expect(events[0]).toMatchObject({ ...turn, type: "item.started", itemType: "tool", title: "mcp__computer__click", input: 'click on "Document" in TextEdit' });
    expect(events[1]).toMatchObject({ ...turn, type: "item.completed", itemType: "tool", ok: true, output: "done", itemId: events[0]!.itemId });
    expect(events[2]).toMatchObject({ ...turn, type: "item.started", title: "mcp__computer__type_text", input: 'type_text on "Document" in TextEdit' });
    expect(events[2]!.itemId).not.toBe(events[0]!.itemId);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(4);
    for (const event of events) expect(Date.parse(event.createdAt)).not.toBeNaN();
  });

  it("stops at a declined step without acting", async () => {
    expect(await runSteps(RECIPE, TURN, { ...deps, approval: denyAt(2) })).toEqual({ kind: "declined", tool: "type_text", label: '"Document" in TextEdit' });
    expect(acted.map(([tool]) => tool)).toEqual(["click"]);
    expect(itemEvents()).toEqual([["item.started", "turn-1", undefined], ["item.completed", "turn-1", true]]);
  });

  it("reports how far it got when a step fails", async () => {
    const out = await runSteps(RECIPE, TURN, { ...deps, caller: failing("type_text", "Fixture failure.") });
    expect(out).toEqual({ kind: "failed", done: 1, total: 2, tool: "type_text", label: '"Document" in TextEdit', error: "Fixture failure." });
    expect(fallbackNote(out as never)).toBe('A saved run of this request did steps 1–1 of 2 and failed at step 2 (type_text on "Document" in TextEdit): Fixture failure. The screen may already be partly changed; look before acting.');
    expect(events.at(-1)).toMatchObject({ type: "item.completed", itemType: "tool", ok: false, output: "Fixture failure." });
  });

  it("marks a step the control gate refused, while resolving or while acting", async () => {
    const busy = (at: string) => computer((tool) => (tool === at ? { ok: false, error: "Another thread is using this computer.", gate: true } : undefined));
    expect(await runSteps(RECIPE, TURN, { ...deps, caller: busy("type_text") })).toEqual({
      kind: "failed", done: 1, total: 2, tool: "type_text", label: '"Document" in TextEdit', error: "Another thread is using this computer.", gate: true });
    expect(await runSteps(RECIPE, TURN, { ...deps, caller: busy("list_apps") })).toEqual({
      kind: "failed", done: 0, total: 2, tool: "click", label: '"Document" in TextEdit', error: "Another thread is using this computer.", gate: true });
  });

  it("fails a step whose target is gone before asking about it", async () => {
    const quit = computer((tool) => (tool === "list_apps" ? { ok: true, structured: { apps: [] } } : undefined));
    expect(await runSteps(RECIPE, TURN, { ...deps, caller: quit }))
      .toEqual({ kind: "failed", done: 0, total: 2, tool: "click", label: '"Document" in TextEdit', error: "TextEdit is not running" });
    expect(asked).toEqual([]);
    expect(acted).toEqual([]);
    expect(events).toEqual([]);
  });

  it("stops when the signal aborts during an approval", async () => {
    const controller = new AbortController();
    let pending!: (allowed: boolean) => void;
    const held: StepApproval = { ask: (tool, summary) => { asked.push([tool, summary]); return new Promise((resolve) => { pending = resolve; }); } };
    const run = runSteps(RECIPE, TURN, { ...deps, approval: held, signal: controller.signal });
    await expect.poll(() => asked.length).toBe(1);
    controller.abort();
    pending(true);
    expect(await run).toEqual({ kind: "stopped" });
    expect(acted).toEqual([]);
    expect(events).toEqual([]);
  });

  it("reads a refusal after an abort as a stop, not a decline", async () => {
    const controller = new AbortController();
    const refusing: StepApproval = { async ask() { controller.abort(); return false; } };
    expect(await runSteps(RECIPE, TURN, { ...deps, approval: refusing, signal: controller.signal })).toEqual({ kind: "stopped" });
  });

  it("stops, rather than fails, when the signal aborts during a step's call", async () => {
    const controller = new AbortController();
    const cut = computer((tool) => {
      if (tool !== "click") return undefined;
      controller.abort();
      return { ok: false, error: "MCP operation cancelled" };
    });
    expect(await runSteps(RECIPE, TURN, { ...deps, caller: cut, signal: controller.signal })).toEqual({ kind: "stopped" });
    expect(asked).toHaveLength(1);
    expect(itemEvents()).toEqual([["item.started", "turn-1", undefined], ["item.completed", "turn-1", false]]);
  });

  it("does nothing once the signal has already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await runSteps(RECIPE, TURN, { ...deps, signal: controller.signal })).toEqual({ kind: "stopped" });
    expect(asked).toEqual([]);
    expect(events).toEqual([]);
  });
});

describe("replay wording", () => {
  it("words a failure at the first step", () => expect(fallbackNote({ kind: "failed", done: 0, total: 2, tool: "click", label: '"Document" in TextEdit', error: "TextEdit is not running" }))
    .toBe('A saved run of this request failed at step 1 of 2 (click on "Document" in TextEdit): TextEdit is not running. The screen may already be partly changed; look before acting.'));

  it("ends the note with one period whatever the error ends with", () => {
    const note = fallbackNote({ kind: "failed", done: 2, total: 3, tool: "click", label: "Save", error: "Not performed . . \n" });
    expect(note).toBe("A saved run of this request did steps 1–2 of 3 and failed at step 3 (click on Save): Not performed. The screen may already be partly changed; look before acting.");
  });

  it("says what was declined", () => expect(declinedReply({ kind: "declined", tool: "type_text", label: '"Document" in TextEdit' }))
    .toBe('I stopped repeating the saved steps: type_text on "Document" in TextEdit was declined.'));
});
