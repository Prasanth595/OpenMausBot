import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderInstance, RuntimeEvent, SendTurnInput, TurnStartResult } from "../contracts.ts";
import { requestKey } from "./key.ts";
import type { Recipe, RecipeStep } from "./rules.ts";
import { createSavedSteps, savedStepsEnabled } from "./saved-steps.ts";

const FAKE = fileURLToPath(new URL("../testing/fake-mcp-server.ts", import.meta.url));
const REQUEST = "Open TextEdit and type hello world";
const TARGET: Pick<RecipeStep, "app" | "window" | "element"> = {
  app: { bundleId: "com.apple.TextEdit", name: "TextEdit" },
  window: { title: "Untitled" },
  element: { role: "AXTextArea", label: "Document", path: ["AXScrollArea:"] },
};
const RECIPE: Recipe = {
  id: "r1", key: requestKey(REQUEST), request: REQUEST, reply: "Typed hello world into TextEdit.", createdAt: Date.now(), lastUsedAt: Date.now(),
  steps: [{ tool: "click", args: {}, ...TARGET }, { tool: "type_text", args: { text: "hello world" }, ...TARGET }],
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

describe("savedStepsEnabled", () => {
  it("is on unless turned off", () => {
    expect(savedStepsEnabled({})).toBe(true);
    expect(savedStepsEnabled({ features: {} })).toBe(true);
    expect(savedStepsEnabled({ features: { savedSteps: true } })).toBe(true);
    expect(savedStepsEnabled({ features: { savedSteps: false } })).toBe(false);
  });
});

describe("createSavedSteps", () => {
  it("runs the AI when the thread has no turn generation to keep the request from saving", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-saved-steps-facade-"));
    dirs.push(dir);
    const events: RuntimeEvent[] = [];
    const slots = new Map<string, ProviderInstance>();
    const steps = createSavedSteps({
      enabled: () => true,
      publish: (event) => events.push(event),
      engines: { get: (threadId) => slots.get(threadId), set: (threadId, engine) => { slots.set(threadId, engine); } },
      stopped: () => false,
      generation: () => undefined,
      folder: (botId) => join(dir, botId),
    });
    steps.recipes.save("b1", RECIPE);
    const engine = { instanceId: "claude", driverKind: "claudeAgent", adapter: { provider: "claudeAgent" } } as unknown as ProviderInstance;
    const start = vi.fn(async (_input: SendTurnInput): Promise<TurnStartResult> => ({ turnId: "e1" }));
    const input: SendTurnInput = { threadId: "t1", botId: "b1", text: REQUEST, approvalMode: "full",
      integrations: { localComputer: { command: process.execPath, args: ["--experimental-strip-types", FAKE], env: {}, scope: "local-computer" } } };

    expect(await steps.dispatch.sendTurn(engine, { botId: "b1", message: { id: "m1", at: 1, role: "user", kind: "text", text: REQUEST }, turnText: REQUEST }, input, start))
      .toEqual({ turnId: "e1" });
    expect(start).toHaveBeenCalledWith(input);
    expect(events).toEqual([]);
    expect(slots.size).toBe(0);
    expect(steps.recipes.find("b1", RECIPE.key)?.id).toBe(RECIPE.id);
  });

  it("replays from the bot's own store on the turn's computer and keeps the request from saving", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-saved-steps-facade-"));
    dirs.push(dir);
    const events: RuntimeEvent[] = [];
    const slots = new Map<string, ProviderInstance>();
    const steps = createSavedSteps({
      enabled: () => true,
      publish: (event) => events.push(event),
      engines: { get: (threadId) => slots.get(threadId), set: (threadId, engine) => { slots.set(threadId, engine); } },
      stopped: () => false,
      generation: (threadId) => (threadId === "t1" ? "g1" : undefined),
      folder: (botId) => join(dir, botId),
    });
    steps.recipes.save("b1", RECIPE);
    const engine = { instanceId: "claude", driverKind: "claudeAgent", adapter: { provider: "claudeAgent" } } as unknown as ProviderInstance;
    const start = vi.fn(async (_input: SendTurnInput): Promise<TurnStartResult> => ({ turnId: "e1" }));
    const computer = { command: process.execPath, args: ["--experimental-strip-types", FAKE], env: {}, scope: "local-computer" as const };

    const { turnId } = await steps.dispatch.sendTurn(engine, { botId: "b1", message: { id: "m1", at: 1, role: "user", kind: "text", text: REQUEST }, turnText: REQUEST },
      { threadId: "t1", botId: "b1", text: REQUEST, approvalMode: "full", integrations: { localComputer: computer } }, start);

    expect(steps.journal.take("t1", new Set(["g1"]))).toEqual({ calls: [], complete: true, tainted: true });
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(start.mock.calls[0]![0].text).toContain("failed at step 1 of 2 (click on \"Document\" in TextEdit): TextEdit is not running.");
    expect(steps.recipes.find("b1", RECIPE.key)).toBeUndefined();
    expect(events[0]).toMatchObject({ type: "turn.started", turnId });
    expect(slots.get("t1")).toBe(engine);
  });
});
