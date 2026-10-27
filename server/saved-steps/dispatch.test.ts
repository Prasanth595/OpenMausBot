import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { newId, type ProviderInstance, type RuntimeEvent, type RuntimeEventListener, type SendTurnInput, type TurnStartResult } from "../contracts.ts";
import { EventBus } from "../harness/bus.ts";
import { QuickModelFallback } from "../quick-model-fallback.ts";
import type { Message } from "../store.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { completeWindowState, windowState } from "../testing/saved-steps-fixtures.ts";
import { SavedStepsDispatch, type DispatchDeps, type ReplayRequest } from "./dispatch.ts";
import { requestKey } from "./key.ts";
import { declinedReply, fallbackNote } from "./replay.ts";
import type { CallOutcome, ComputerCaller } from "./resolve.ts";
import type { Recipe, RecipeStep } from "./rules.ts";

const REQUEST = "Open TextEdit and type hello world";
const TARGET: Pick<RecipeStep, "app" | "window" | "element"> = {
  app: { bundleId: "com.apple.TextEdit", name: "TextEdit" },
  window: { title: "Untitled" },
  element: { role: "AXTextArea", label: "Document", path: ["AXScrollArea:"] },
};
const RECIPE: Recipe = {
  id: "r1", key: requestKey(REQUEST), request: REQUEST, reply: "Typed hello world into TextEdit.", createdAt: 1_000, lastUsedAt: 1_000,
  steps: [{ tool: "click", args: {}, ...TARGET }, { tool: "type_text", args: { text: "hello world" }, ...TARGET }],
};
const LABEL = '"Document" in TextEdit';
const FAILED = { kind: "failed", done: 1, total: 2, tool: "type_text", label: LABEL, error: "Fixture failure." } as const;
const COMPUTER = { command: "gated-computer", args: ["--turn"], env: { OMB_CONTROL_TOKEN: "turn-token" }, platform: "darwin" as const, scope: "local-computer" as const };
const INPUT: SendTurnInput = { threadId: "t1", botId: "b1", text: REQUEST, approvalMode: "full", integrations: { localComputer: COMPUTER } };
const MESSAGE: Message = { id: "m1", at: 1, role: "user", kind: "text", text: REQUEST };
const REQ: ReplayRequest = { botId: "b1", message: MESSAGE };
const OBSERVATIONS = new Set(["list_apps", "list_windows", "get_window_state"]);

type Answer = "allow" | "deny" | undefined;

function engineStub() {
  const adapter = {
    provider: "claudeAgent",
    capabilities: { sessionModelSwitch: "unsupported" as const, queueing: true },
    cacheKeepWarm: { ping: vi.fn(), hold: vi.fn(() => true) },
    sendTurn: vi.fn(async (): Promise<TurnStartResult> => ({ turnId: "never" })),
    interruptTurn: vi.fn(async () => {}),
    respondToRequest: vi.fn(async () => "rejected" as const),
    steer: vi.fn(async () => "steered" as const),
    hasSession: vi.fn(() => true),
    stopAll: vi.fn(async () => {}),
    onEvent: vi.fn(() => () => {}),
  };
  return { instanceId: "claude", driverKind: "claudeAgent", adapter } as unknown as ProviderInstance & { adapter: typeof adapter };
}

let acted: string[];
let events: RuntimeEvent[];
let answer: (event: Extract<RuntimeEvent, { type: "request.opened" }>) => Answer;
let failAt: string | undefined;
let throwAt: string | undefined;
let slots: Map<string, ProviderInstance>;
let engine: ReturnType<typeof engineStub>;
let start: Mock<(input: SendTurnInput) => Promise<TurnStartResult>>;
let close: Mock<() => Promise<void>>;
let recipes: { find: Mock<(botId: string, key: string) => Recipe | undefined>; forget: Mock<(botId: string, recipeId: string) => boolean> };
let openCaller: Mock<DispatchDeps["openCaller"]>;
let taint: Mock<(threadId: string) => void>;
let deps: DispatchDeps;
let stopped: boolean;
let dispatch: SavedStepsDispatch;

function computer(): ComputerCaller {
  let snapshot = 2;
  return {
    async call(tool) {
      if (tool === throwAt) throw new Error("the fixture computer broke");
      if (tool === failAt) return { ok: false, error: "Fixture failure." } satisfies CallOutcome;
      if (tool === "list_apps") return { ok: true, structured: { apps: [{ pid: 4242, name: "TextEdit", bundle_id: "com.apple.TextEdit", running: true }] } };
      if (tool === "list_windows") return { ok: true, structured: { windows: [{ window_id: 7, pid: 4242, title: "Untitled", app_name: "TextEdit" }] } };
      if (tool === "get_window_state") return { ok: true, structured: completeWindowState(windowState(snapshot++)) };
      if (OBSERVATIONS.has(tool)) throw new Error(`unexpected ${tool}`);
      acted.push(tool);
      return { ok: true, structured: {} };
    },
  };
}

const types = () => events.map((event) => event.type);
const turnCompleted = () => events.filter((event) => event.type === "turn.completed");
const settled = () => vi.waitFor(() => expect(turnCompleted().length + start.mock.calls.length).toBeGreaterThan(0));
const asked = () => vi.waitFor(() => expect(events.some((event) => event.type === "request.opened")).toBe(true));
const ev = (type: string, turnId: string, threadId = "t1") => ({
  eventId: newId(), createdAt: "2026-10-27T00:00:00Z", provider: "claudeAgent", providerInstanceId: "claude", threadId, turnId, type,
  ...(type === "item.completed" ? { itemType: "assistant_text", text: "Done by the AI." } : {}),
  ...(type === "turn.completed" ? { ok: true } : {}),
}) as RuntimeEvent;

beforeEach(() => {
  acted = [];
  events = [];
  answer = () => "allow";
  failAt = undefined;
  throwAt = undefined;
  stopped = false;
  engine = engineStub();
  slots = new Map([["t1", engine as ProviderInstance]]);
  start = vi.fn(async () => ({ turnId: "e1" }));
  close = vi.fn(async () => {});
  recipes = { find: vi.fn((botId: string, key: string) => (botId === "b1" && key === RECIPE.key ? RECIPE : undefined)), forget: vi.fn(() => true) };
  openCaller = vi.fn(async () => ({ ...computer(), close }));
  taint = vi.fn();
  deps = {
    recipes,
    enabled: () => true,
    publish: (event) => {
      events.push(event);
      if (event.type !== "request.opened") return;
      const behavior = answer(event);
      if (behavior) void slots.get(event.threadId)!.adapter.respondToRequest(event.threadId, event.requestId!, { behavior });
    },
    engines: { get: (threadId) => slots.get(threadId), set: (threadId, instance) => { slots.set(threadId, instance); } },
    stopped: () => stopped,
    openCaller,
    taint,
  };
  dispatch = new SavedStepsDispatch(deps);
});

describe("SavedStepsDispatch.sendTurn", () => {
  it.each([
    ["no request", null, INPUT],
    ["Ask", REQ, { ...INPUT, approvalMode: "ask" }],
    ["Auto", REQ, { ...INPUT, approvalMode: "auto" }],
    ["no host computer", REQ, { ...INPUT, integrations: {} }],
    ["another computer", REQ, { ...INPUT, integrations: { localComputer: { ...COMPUTER, scope: undefined } } }],
    ["spoken", { ...REQ, message: { ...REQ.message, via: "call" } }, INPUT],
    ["no saved steps", { ...REQ, message: { ...REQ.message, text: "open notes" } }, INPUT],
    ["new words", { ...REQ, message: { ...REQ.message, text: "open textedit and type hello, world" } }, INPUT],
  ])("passes through: %s", async (_, request, input) => {
    expect(await dispatch.sendTurn(engine, request as never, input as SendTurnInput, start)).toEqual({ turnId: "e1" });
    expect(start).toHaveBeenCalledWith(input);
    expect(events).toEqual([]);
    expect(openCaller).not.toHaveBeenCalled();
    expect(taint).not.toHaveBeenCalled();
    expect(slots.get("t1")).toBe(engine);
  });

  it("passes through while the setting is off", async () => {
    dispatch = new SavedStepsDispatch({ ...deps, enabled: () => false });
    expect(await dispatch.sendTurn(engine, REQ, INPUT, start)).toEqual({ turnId: "e1" });
    expect(start).toHaveBeenCalledWith(INPUT);
    expect(recipes.find).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it("answers a saved request with no engine call", async () => {
    const { turnId } = await dispatch.sendTurn(engine, REQ, INPUT, start);
    await settled();
    expect(start).not.toHaveBeenCalled();
    expect(engine.adapter.sendTurn).not.toHaveBeenCalled();
    expect(acted).toEqual(["click", "type_text"]);
    expect(types()).toEqual(["turn.started", "request.opened", "request.resolved", "item.started", "item.completed", "request.opened",
      "request.resolved", "item.started", "item.completed", "item.completed", "turn.completed"]);
    expect(events.every((event) => event.turnId === turnId && event.threadId === "t1")).toBe(true);
    expect(events.find((e) => e.type === "request.opened")).toMatchObject({
      requestType: "permission", tool: "mcp__computer__click", summary: `click on ${LABEL}`, approvalScope: "local-computer", allowSession: false, turnId,
    });
    expect(events.filter((e) => e.type === "request.opened")[1]).toMatchObject({ tool: "mcp__computer__type_text", summary: `type_text "hello world" on ${LABEL}` });
    expect(events.find((e) => e.type === "request.resolved")).toMatchObject({ behavior: "allow", source: "user", approvalScope: "local-computer" });
    expect(events.at(-2)).toMatchObject({ itemType: "assistant_text", text: RECIPE.reply });
    expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true, stopReason: "end_turn", provider: "claudeAgent", providerInstanceId: "claude" });
    expect(dispatch.replayed("t1", turnId)).toBe(RECIPE.id);
    expect(dispatch.replayed("t1", "another-turn")).toBeUndefined();
    expect(recipes.forget).not.toHaveBeenCalled();
  });

  it("drives the turn's own gated computer and closes it", async () => {
    await dispatch.sendTurn(engine, REQ, INPUT, start);
    await settled();
    expect(openCaller).toHaveBeenCalledTimes(1);
    expect(openCaller.mock.calls[0]![0]).toBe(INPUT.integrations!.localComputer);
    expect(openCaller.mock.calls[0]![1]).toBeInstanceOf(AbortSignal);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("marks the request so its steps are never saved again from this turn", async () => {
    await dispatch.sendTurn(engine, REQ, INPUT, start);
    expect(taint).toHaveBeenCalledWith("t1");
    await settled();
  });

  it("binds the turn before any of its events", async () => {
    const sent = dispatch.sendTurn(engine, REQ, INPUT, start);
    expect(events).toEqual([]);
    const { turnId } = await sent;
    expect(events).toEqual([]);
    await settled();
    expect(events[0]).toMatchObject({ type: "turn.started", turnId });
  });

  it("stands in for the engine while it replays", async () => {
    answer = () => undefined;
    await dispatch.sendTurn(engine, REQ, INPUT, start);
    await asked();
    const standIn = slots.get("t1")!;
    expect(standIn.instanceId).toBe("claude");
    expect(standIn.driverKind).toBe("claudeAgent");
    expect(standIn.adapter).not.toBe(engine.adapter);
    expect(standIn.adapter.provider).toBe("claudeAgent");
    expect(standIn.adapter.capabilities).toBe(engine.adapter.capabilities);
    expect(standIn.adapter.cacheKeepWarm).toBe(engine.adapter.cacheKeepWarm);
    expect(standIn.adapter.hasSession("t1")).toBe(true);
    expect(engine.adapter.hasSession).toHaveBeenCalledWith("t1");
    expect(await standIn.adapter.steer!("t1", "faster")).toBe("refused");
    expect(engine.adapter.steer).not.toHaveBeenCalled();
    expect(await standIn.adapter.respondToRequest("t1", "an-engine-request", { behavior: "allow" })).toBe("rejected");
    expect(engine.adapter.respondToRequest).toHaveBeenCalledWith("t1", "an-engine-request", { behavior: "allow" });
    const opened = events.find((e) => e.type === "request.opened")!;
    expect(await standIn.adapter.respondToRequest("t1", opened.requestId!, { behavior: "allow" })).toBe("allowed-once");
    expect(engine.adapter.respondToRequest).toHaveBeenCalledTimes(1);
    answer = () => "allow";
    await settled();
    expect(engine.adapter.interruptTurn).not.toHaveBeenCalled();
  });

  it("a declined step ends the turn without the AI and keeps the recipe", async () => {
    answer = (event) => (event.tool === "mcp__computer__type_text" ? "deny" : "allow");
    const { turnId } = await dispatch.sendTurn(engine, REQ, INPUT, start);
    await settled();
    expect(acted).toEqual(["click"]);
    expect(events.at(-2)).toMatchObject({ type: "item.completed", itemType: "assistant_text", turnId, text: declinedReply({ kind: "declined", tool: "type_text", label: LABEL }) });
    expect(events.at(-1)).toMatchObject({ type: "turn.completed", turnId, ok: true, stopReason: "end_turn", denials: ["mcp__computer__type_text"] });
    expect(events.filter((e) => e.type === "request.resolved").at(-1)).toMatchObject({ behavior: "deny", source: "user" });
    expect(start).not.toHaveBeenCalled();
    expect(recipes.forget).not.toHaveBeenCalled();
    expect(dispatch.replayed("t1", turnId)).toBeUndefined();
  });

  it("a failed step forgets the recipe and hands the request to the AI under the replay's turn id", async () => {
    failAt = "type_text";
    const { turnId } = await dispatch.sendTurn(engine, REQ, INPUT, start);
    await settled();
    expect(recipes.forget).toHaveBeenCalledWith("b1", RECIPE.id);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]![0]).toEqual({ ...INPUT, text: `${INPUT.text}\n\n${fallbackNote(FAILED)}` });
    expect(start.mock.calls[0]![0]).not.toHaveProperty("recoveryText");
    expect(engines()).toBe(engine);
    expect(close).toHaveBeenCalledTimes(1);
    expect(turnCompleted()).toEqual([]);
    expect(events.some((e) => e.type === "item.completed" && e.itemType === "assistant_text")).toBe(false);
    const replayed = events.length;
    expect(dispatch.take(ev("turn.started", "e1"))).toBe(true);
    expect(dispatch.take(ev("item.completed", "e1"))).toBe(true);
    expect(dispatch.take(ev("turn.completed", "e1"))).toBe(true);
    expect(events.length).toBe(replayed + 2);
    expect(events.slice(-2).map((e) => [e.type, e.turnId])).toEqual([["item.completed", turnId], ["turn.completed", turnId]]);
    expect(events.at(-2)).toMatchObject({ text: "Done by the AI." });
    expect(dispatch.take(ev("item.completed", "e1"))).toBe(false);
    expect(dispatch.replayed("t1", turnId)).toBeUndefined();
  });

  it("appends the note to recoveryText too", async () => {
    failAt = "type_text";
    await dispatch.sendTurn(engine, REQ, { ...INPUT, recoveryText: "The conversation so far." }, start);
    await settled();
    expect(start.mock.calls[0]![0]).toMatchObject({
      text: `${INPUT.text}\n\n${fallbackNote(FAILED)}`, recoveryText: `The conversation so far.\n\n${fallbackNote(FAILED)}`,
    });
  });

  it("counts a computer that cannot start as a failure at the first step", async () => {
    openCaller.mockRejectedValueOnce(new Error("MCP server could not start; check its command and installation"));
    await dispatch.sendTurn(engine, REQ, INPUT, start);
    await settled();
    expect(recipes.forget).toHaveBeenCalledWith("b1", RECIPE.id);
    expect(start.mock.calls[0]![0].text).toBe(`${INPUT.text}\n\n${fallbackNote({
      kind: "failed", done: 0, total: 2, tool: "click", label: LABEL, error: "MCP server could not start; check its command and installation",
    })}`);
    expect(close).not.toHaveBeenCalled();
  });

  it("leaves other threads' and turns' events alone", async () => {
    failAt = "type_text";
    const { turnId } = await dispatch.sendTurn(engine, REQ, INPUT, start);
    await settled();
    expect(dispatch.take(ev("item.completed", "e1", "t2"))).toBe(false);
    expect(dispatch.take(ev("item.completed", "x"))).toBe(false);
    expect(dispatch.take(ev("item.completed", turnId))).toBe(false);
    expect(dispatch.take({ ...ev("runtime.error", "e1"), turnId: undefined })).toBe(false);
  });

  it("follows the AI turn that reports before its sendTurn answers", async () => {
    failAt = "type_text";
    let answerStart!: (result: TurnStartResult) => void;
    start.mockImplementationOnce(() => new Promise((resolve) => { answerStart = resolve; }));
    const { turnId } = await dispatch.sendTurn(engine, REQ, INPUT, start);
    await settled();
    expect(dispatch.take(ev("turn.started", "e1"))).toBe(true);
    expect(dispatch.take(ev("item.completed", "e1"))).toBe(true);
    answerStart({ turnId: "e1" });
    await Promise.resolve();
    expect(dispatch.take(ev("turn.completed", "e1"))).toBe(true);
    expect(events.slice(-2).map((e) => [e.type, e.turnId])).toEqual([["item.completed", turnId], ["turn.completed", turnId]]);
  });

  it("a fallback that cannot start ends the turn with its error", async () => {
    failAt = "type_text";
    start.mockRejectedValueOnce(new Error("Claude could not start"));
    const { turnId } = await dispatch.sendTurn(engine, REQ, INPUT, start);
    await vi.waitFor(() => expect(turnCompleted()).toHaveLength(1));
    expect(events.slice(-2)).toMatchObject([
      { type: "runtime.error", turnId, message: "Claude could not start" },
      { type: "turn.completed", turnId, ok: false, stopReason: "Claude could not start" },
    ]);
    expect(dispatch.take(ev("item.completed", "e1"))).toBe(false);
  });

  it("interrupts the AI when the person stopped while it was starting", async () => {
    failAt = "type_text";
    start.mockImplementationOnce(async () => {
      stopped = true;
      return { turnId: "e1" };
    });
    await dispatch.sendTurn(engine, REQ, INPUT, start);
    await vi.waitFor(() => expect(engine.adapter.interruptTurn).toHaveBeenCalledWith("t1"));
  });

  it("does not start the AI for a request the person already stopped", async () => {
    failAt = "type_text";
    answer = (event) => {
      if (event.tool === "mcp__computer__type_text") stopped = true;
      return "allow";
    };
    await dispatch.sendTurn(engine, REQ, INPUT, start);
    await vi.waitFor(() => expect(turnCompleted()).toHaveLength(1));
    expect(start).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: false, stopReason: "interrupted" });
    expect(recipes.forget).toHaveBeenCalledWith("b1", RECIPE.id);
  });

  it("Stop during a replay ends the turn interrupted", async () => {
    answer = () => undefined;
    const { turnId } = await dispatch.sendTurn(engine, REQ, INPUT, start);
    await asked();
    await slots.get("t1")!.adapter.interruptTurn("t1");
    expect(events.at(-1)).toMatchObject({ type: "turn.completed", turnId, ok: false, stopReason: "interrupted" });
    expect(events.filter((e) => e.type === "request.resolved")).toMatchObject([{ behavior: "deny", source: "system" }]);
    expect(acted).toEqual([]);
    expect(start).not.toHaveBeenCalled();
    expect(recipes.forget).not.toHaveBeenCalled();
    expect(engine.adapter.interruptTurn).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("Stop while the computer is still starting ends the turn interrupted", async () => {
    openCaller.mockImplementationOnce((_computer: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("MCP operation cancelled")), { once: true });
    }));
    await dispatch.sendTurn(engine, REQ, INPUT, start);
    await vi.waitFor(() => expect(openCaller).toHaveBeenCalled());
    await slots.get("t1")!.adapter.interruptTurn("t1");
    expect(types()).toEqual(["turn.started", "turn.completed"]);
    expect(events.at(-1)).toMatchObject({ ok: false, stopReason: "interrupted" });
    expect(start).not.toHaveBeenCalled();
    expect(recipes.forget).not.toHaveBeenCalled();
  });

  it("hands Stop to the engine once the AI has taken over", async () => {
    failAt = "type_text";
    answer = () => undefined;
    await dispatch.sendTurn(engine, REQ, INPUT, start);
    await asked();
    const standIn = slots.get("t1")!;
    answer = () => "allow";
    const opened = events.find((e) => e.type === "request.opened")!;
    await standIn.adapter.respondToRequest("t1", opened.requestId!, { behavior: "allow" });
    await settled();
    await standIn.adapter.interruptTurn("t1", "e1");
    expect(engine.adapter.interruptTurn).toHaveBeenCalledWith("t1", "e1");
  });

  it("closes the computer and ends the turn when a step throws", async () => {
    throwAt = "list_apps";
    close.mockRejectedValueOnce(new Error("could not stop the computer"));
    const { turnId } = await dispatch.sendTurn(engine, REQ, INPUT, start);
    await settled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(events.slice(-2)).toMatchObject([
      { type: "runtime.error", turnId, message: "the fixture computer broke" },
      { type: "turn.completed", turnId, ok: false, stopReason: "the fixture computer broke" },
    ]);
    expect(recipes.forget).toHaveBeenCalledWith("b1", RECIPE.id);
  });

  it("forgets an earlier turn's fallback when the next turn starts", async () => {
    failAt = "type_text";
    start.mockImplementationOnce(() => new Promise(() => {}));
    await dispatch.sendTurn(engine, REQ, INPUT, start);
    await settled();
    await dispatch.sendTurn(engine, null, INPUT, start);
    expect(dispatch.take(ev("turn.started", "e2"))).toBe(false);
  });
});

function engines() {
  return slots.get("t1");
}

describe("SavedStepsDispatch with the quick model fallback", () => {
  let scratch: string;
  afterEach(async () => {
    vi.restoreAllMocks();
    await removeTempDir(scratch);
  });

  it("shows a refused quick model's retry as the replay's one turn", async () => {
    scratch = mkdtempSync(join(tmpdir(), "omb-saved-steps-dispatch-"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const listeners = new Set<RuntimeEventListener>();
    const sent: SendTurnInput[] = [];
    const scripts: Array<(emit: (type: string, extra?: Record<string, unknown>) => void) => void> = [
      (emit) => {
        emit("turn.started");
        emit("runtime.error", { message: "400 invalid_request_error: quick-model is not supported" });
        emit("turn.completed", { ok: false, stopReason: "400 invalid_request_error: quick-model is not supported" });
      },
      (emit) => {
        emit("turn.started");
        emit("item.completed", { itemType: "assistant_text", text: "Typed it." });
        emit("turn.completed", { ok: true });
      },
    ];
    const adapter = {
      provider: "claudeAgent",
      onEvent: (listener: RuntimeEventListener) => { listeners.add(listener); return () => listeners.delete(listener); },
      sendTurn: async (input: SendTurnInput) => {
        sent.push(input);
        const turnId = `turn-${sent.length}`;
        const play = scripts[sent.length - 1]!;
        setImmediate(() => play((type, extra = {}) => {
          for (const listener of listeners) listener({ eventId: newId(), provider: "claudeAgent", threadId: input.threadId, turnId, createdAt: "2026-10-27T00:00:00Z", type, ...extra } as RuntimeEvent);
        }));
        return { turnId };
      },
      interruptTurn: async () => {},
    };
    const real = { instanceId: "claude", driverKind: "claudeAgent", adapter } as unknown as ProviderInstance;
    failAt = "list_apps";
    let bus!: EventBus;
    const quick = new QuickModelFallback({ file: join(scratch, "refused.json"), publish: (event) => { if (!composed.take(event)) bus.publish(event); }, stopped: () => false });
    const composed: SavedStepsDispatch = new SavedStepsDispatch({ ...deps, publish: (event) => bus.publish(event) });
    bus = new EventBus(() => {}, (event) => quick.take(event) || composed.take(event));
    bus.attach([real]);
    const delivered: RuntimeEvent[] = [];
    bus.subscribe((event) => delivered.push(event));

    const { turnId } = await composed.sendTurn(real, REQ, { ...INPUT, model: "quick-model" }, (input) =>
      quick.sendTurn(real, input, { model: "quick-model", own: { model: "own-model" }, onFallback: () => {} }));
    await vi.waitFor(() => expect(delivered.some((event) => event.type === "turn.completed")).toBe(true));
    bus.detachAll();

    expect(delivered.map((event) => [event.type, event.turnId])).toEqual([
      ["turn.started", turnId], ["item.completed", turnId], ["turn.completed", turnId],
    ]);
    expect(delivered.at(-1)).toMatchObject({ ok: true });
    expect(delivered[1]).toMatchObject({ itemType: "assistant_text", text: "Typed it." });
    const note = fallbackNote({ kind: "failed", done: 0, total: 2, tool: "click", label: LABEL, error: "Fixture failure." });
    expect(sent.map(({ model, text }) => ({ model, text }))).toEqual([
      { model: "quick-model", text: `${INPUT.text}\n\n${note}` }, { model: "own-model", text: `${INPUT.text}\n\n${note}` },
    ]);
  });
});
