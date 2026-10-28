// @vitest-environment happy-dom
// The strip is mounted in ChatView's header, and switching a thread remounts Composer. This mounts the real ChatView
// so removing the strip, or losing the post-switch refocus, fails here rather than only in the isolated tab tests.
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
vi.mock("@/lib/thread-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => true,
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: vi.fn() }));

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState, reducer } = await import("@/state/store");

const at = 1_700_000_000_000;
const tasks: Task[] = Array.from({ length: 9 }, (_, index) => ({
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
const calls: Action[] = [];
let container: HTMLDivElement;

const draw = () => {
  const value = {
    state,
    dispatch: (action: Action) => {
      calls.push(action);
      state = reducer(state, action);
      // The real store asks the server for the thread, then applies taskSwitched with the returned bot.
      if (action.type === "switchTask") {
        const target = state.bots.find((entry) => entry.id === action.botId)!;
        state = reducer(state, { type: "taskSwitched", bot: { ...target, threadId: action.threadId } });
      }
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
  draw();
});

afterAll(() => {
  flushSync(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const tab = (threadId: string) => document.querySelector<HTMLButtonElement>(`[data-thread-tab="${threadId}"]`);
const wait = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

describe("the thread strip inside the chat header", () => {
  it("is mounted in ChatView and keeps focus on the chosen tab after a switch remounts Composer", async () => {
    expect(document.querySelector('[role="tablist"]')).not.toBeNull();
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(9);

    const chosen = tab("thread-4")!;
    chosen.focus();
    expect(document.activeElement).toBe(chosen);
    chosen.click();
    await wait();

    expect(calls).toEqual([{ type: "switchTask", botId: "pepper", threadId: "thread-4" }]);
    expect(state.bots[0]!.threadId).toBe("thread-4");
    expect(document.activeElement?.getAttribute("data-thread-tab")).toBe("thread-4");
    expect(document.querySelector("textarea")).not.toBe(document.activeElement);
  });
});
