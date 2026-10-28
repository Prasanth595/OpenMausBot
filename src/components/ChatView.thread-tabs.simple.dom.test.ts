// @vitest-environment happy-dom
// Simple mode hides the bot panel's Conversations card, so the chat header is the only place to switch threads there.
// These tests mount the real ChatView and fail if the strip goes back to being Advanced-mode only.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Action, AppState, Bot, InstanceInfo, Task } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true, useReactor: () => "user" }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const fixture = { advanced: false, threadsShown: false, threadsWanted: true };
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: vi.fn() }));
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => fixture.threadsShown,
  useShowThreadsChoice: () => fixture.threadsWanted,
}));

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState, reducer } = await import("@/state/store");

const at = 1_700_000_000_000;
const tasks: Task[] = Array.from({ length: 4 }, (_, index) => ({
  threadId: `thread-${index + 1}`,
  title: `Conversation ${index + 1}`,
  createdAt: at - index * 1_000,
  updatedAt: at - index * 1_000,
  lastThreadOrderAt: at - index * 1_000,
  modelSelection: { instanceId: "test", model: "m" },
  approvalMode: "ask",
  busy: false,
  activity: "idle",
}));
const bot: Bot = {
  id: "pepper", threadId: "thread-1", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "m" },
  tasks,
};

let state: AppState;
let root: Root;
let container: HTMLDivElement;

const draw = () => {
  const value = {
    state,
    dispatch: (action: Action) => {
      state = reducer(state, action);
      draw();
    },
    flushBotPatches: async () => null,
    refreshInstances: async () => {},
    refreshModels: async () => {},
  };
  const current = state.bots.find((entry) => entry.id === state.selectedId)!;
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(ChatView, { bot: current }) })));
};

beforeAll(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  state = {
    ...initialState,
    connected: true,
    selectedId: bot.id,
    bots: [bot],
    instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
  };
});

afterAll(() => {
  flushSync(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const strip = () => document.querySelector('[role="tablist"]');

describe("the thread strip in Simple mode", () => {
  it("renders the tabs in the chat header even though Simple mode hides the conversations panel", () => {
    fixture.advanced = false;
    fixture.threadsShown = false;
    fixture.threadsWanted = true;
    draw();

    expect(strip()).not.toBeNull();
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(4);
  });

  it("still hides the strip when the person has turned threads off", () => {
    fixture.threadsWanted = false;
    draw();

    expect(strip()).toBeNull();
  });
});
