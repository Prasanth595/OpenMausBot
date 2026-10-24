// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotEditorStore, initialState, type AppState, type Bot, type Group } from "@/state/store";
import { setUnreadIndicators } from "@/lib/notification-preferences";
import type { NotificationLogEntry } from "../../shared/notification";
import { NotificationsPanel } from "./NotificationsPanel";
import { BotThreadList, GroupListItem, GroupThreadList, botRowProps } from "./Sidebar";
import { BotConversations } from "./bot-panel/Conversations";
import { PinnedCircleThreadSection } from "./PinnedCircleThreads";
import { crossBotAttentionThreads } from "./SidebarBotActivity";
import { useUnreadDivider } from "@/hooks/use-unread-divider";

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/interface-mode", async (original) => ({
  ...await original<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => true,
  useShowThreads: () => true,
}));
vi.mock("@/lib/thread-preferences", async (original) => ({
  ...await original<typeof import("@/lib/thread-preferences")>(),
  useShowThreads: () => true,
}));

const entry = (id: string, read: boolean): NotificationLogEntry => ({
  id, at: 1, read, kind: "done", botId: "atlas", botName: "Atlas", threadId: "t", title: "Atlas finished", body: "",
});
const tasks = [
  { threadId: "thread-atlas", title: "Main", createdAt: 1 },
  { threadId: "second", title: "Second", createdAt: 2, unread: true },
];
const bot: Bot = {
  id: "atlas", threadId: "thread-atlas", name: "Atlas", title: "", description: "", notifications: true, color: "green",
  unread: false, modelSelection: { instanceId: "claude", model: "test" }, messages: [], tasks,
};
const group = { id: "room", name: "Room", dm: false, unread: true, threadId: "room-main", memberIds: ["atlas"], messages: [], tasks: [
  { threadId: "room-main", title: "Room main", createdAt: 1 },
  { threadId: "room-two", title: "Room two", createdAt: 2 },
] } as unknown as Group;

const render = (state: AppState, children: unknown) => createElement(BotEditorStore, {
  value: { state, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} },
  children: children as never,
});

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function offThenOn(element: unknown, present: () => boolean) {
  await act(async () => root.render(element as never));
  expect(present()).toBe(true);
  await act(async () => setUnreadIndicators(false));
  expect(present()).toBe(false);
  await act(async () => setUnreadIndicators(true));
  expect(present()).toBe(true);
}

describe("unread indicators on the remaining surfaces, real preference store", () => {
  it("notifications panel: header count and row dot", async () => {
    const state = { ...initialState, notifications: [entry("a", false), entry("b", true)], bots: [bot] };
    await offThenOn(render(state, createElement(NotificationsPanel)), () => container.textContent!.includes("1 unread") || container.innerHTML.includes("bg-accent/5"));
  });

  it("room row dot", async () => {
    const state = { ...initialState, bots: [bot], groups: [group] };
    await offThenOn(render(state, createElement(GroupListItem, { group, density: "comfortable", onMenu: vi.fn() })), () => container.innerHTML.includes("bg-accent"));
  });

  it("room thread rows", async () => {
    const state = { ...initialState, bots: [bot], groups: [group] };
    await offThenOn(render(state, createElement(GroupThreadList, { group, selected: true })), () => container.innerHTML.includes("Unread"));
  });

  it("bot thread rows", async () => {
    const props = botRowProps(initialState, vi.fn(), bot, { density: "comfortable", quiet: false, query: "", onMenu: vi.fn() });
    await offThenOn(render({ ...initialState, bots: [bot] }, createElement(BotThreadList, props)), () => container.innerHTML.includes("Unread"));
  });

  it("bot panel conversations", async () => {
    await offThenOn(render({ ...initialState, bots: [bot] }, createElement(BotConversations, { bot })), () => container.innerHTML.includes("Unread"));
  });

  it("unread divider id is masked while off, then returns", async () => {
    const Probe = () => createElement("i", { id: "probe" }, useUnreadDivider({ threadId: "thread-atlas", messages: [], following: true }).messageId ?? "none");
    const state = { ...initialState, bots: [bot], unreadDivider: { threadId: "thread-atlas", messageId: "m1" } };
    await offThenOn(render(state, createElement(Probe)), () => container.textContent === "m1");
  });

  it("a room whose only news is unread leaves the attention list while off", () => {
    const ids = (showUnread: boolean) => crossBotAttentionThreads([bot], {}, undefined, [group], showUnread).filter((e) => e.kind === "group").map((e) => e.task.threadId);
    expect(ids(true)).toEqual(["room-main"]);
    expect(ids(false)).toEqual([]);
  });

  it("collapsed pinned section: unread count", async () => {
    const unreadBot = { ...bot, unread: true, tasks: undefined };
    const row = () => botRowProps(initialState, vi.fn(), unreadBot, { density: "comfortable", quiet: false, query: "", onMenu: vi.fn() });
    await offThenOn(render({ ...initialState, bots: [unreadBot] }, createElement(PinnedCircleThreadSection, { bots: [unreadBot], collapsed: true, onToggle: vi.fn(), row })), () => container.textContent!.includes("1 unread"));
  });
});
