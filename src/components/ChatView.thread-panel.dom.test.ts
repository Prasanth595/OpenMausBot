// @vitest-environment happy-dom
// The transcript is only a tabpanel while the strip is actually measurable. A strip hidden by the header's container
// query has clientWidth 0 and must not label the transcript, and an active routine/archived thread has no tab to point at.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Action, AppState, Bot, InstanceInfo, Task } from "@/state/store";

const observers: Array<{ element: Element; fire: () => void }> = [];
class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(element: Element) {
    observers.push({ element, fire: () => this.callback([], this as unknown as ResizeObserver) });
  }
  unobserve() {}
  disconnect() {}
}

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
const task = (threadId: string, order: number, extra: Partial<Task> = {}): Task => ({
  threadId,
  title: `Conversation ${threadId}`,
  createdAt: at - order * 1_000,
  updatedAt: at - order * 1_000,
  lastThreadOrderAt: at - order * 1_000,
  modelSelection: { instanceId: "test", model: "m" },
  approvalMode: "ask",
  busy: false,
  activity: "idle",
  ...extra,
});
const tasks = Array.from({ length: 9 }, (_, index) => task(`thread-${index + 1}`, index));
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

const reset = (next: Bot) => {
  state = { ...state, selectedId: next.id, bots: [next] };
  draw();
};

const list = () => document.querySelector<HTMLElement>('[role="tablist"]');
const panel = () => document.querySelector<HTMLElement>('[role="tabpanel"]');
const setWidth = (width: number) => {
  const element = list();
  if (!element) throw new Error("the strip is not rendered");
  Object.defineProperty(element, "clientWidth", { configurable: true, value: width });
  const observer = [...observers].reverse().find((entry) => entry.element === element);
  flushSync(() => observer?.fire());
};

const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");

beforeAll(() => {
  // happy-dom has no layout; a fresh strip starts at zero until a test gives it a measured width.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 0 });
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
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
  if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
  vi.unstubAllGlobals();
});

describe("the transcript's tabpanel relationship", () => {
  it("stays off at zero measured width, appears when the strip is measurable, and follows the active tab", () => {
    expect(list()).not.toBeNull();
    expect(list()!.clientWidth).toBe(0);
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(9);
    expect(new Set([...document.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => tab.id)).size).toBe(9);
    expect(panel()).toBeNull();
    expect(document.querySelector(".glass-scroller")!.hasAttribute("aria-labelledby")).toBe(false);

    setWidth(352);
    expect(panel()).not.toBeNull();
    expect(panel()!.id).toBe("chat-thread-panel");
    expect(panel()!.getAttribute("aria-labelledby")).toBe("thread-tab-thread-1");

    document.querySelector<HTMLButtonElement>('[data-thread-tab="thread-4"]')!.click();
    flushSync(() => {});
    expect(panel()!.getAttribute("aria-labelledby")).toBe("thread-tab-thread-4");

    setWidth(0);
    expect(list()!.clientWidth).toBe(0);
    expect(panel()).toBeNull();
    expect(document.querySelector(".glass-scroller")!.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("does not render the strip, or label the transcript, when the open thread is a routine run", () => {
    reset({
      ...bot,
      threadId: "run",
      tasks: [task("run", 0, { routineRunId: "run-1" }), task("a", 1), task("b", 2)],
    });
    expect(list()).toBeNull();
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(panel()).toBeNull();
    expect(document.querySelector(".glass-scroller")!.hasAttribute("aria-labelledby")).toBe(false);
    reset(bot);
  });

  it("keeps the tab menu and the rename input outside the controlled panel", () => {
    reset(bot);
    setWidth(352);
    const sheetPanel = panel()!;
    const trigger = document.querySelector<HTMLButtonElement>('[data-thread-tab-item="thread-2"] button[aria-haspopup="menu"]')!;
    expect(sheetPanel.contains(trigger)).toBe(false);

    flushSync(() => trigger.click());
    const rename = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === "Rename thread")!;
    flushSync(() => rename.click());
    const input = document.querySelector<HTMLInputElement>('[data-thread-tab-item="thread-2"] input')!;
    expect(sheetPanel.contains(input)).toBe(false);
    expect(list()!.contains(input)).toBe(true);
  });
});
