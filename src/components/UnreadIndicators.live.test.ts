// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotEditorStore, initialState, type Bot } from "@/state/store";
import { setUnreadIndicators } from "@/lib/notification-preferences";
import type { NotificationLogEntry } from "../../shared/notification";
import { NotificationRail } from "./NotificationsPanel";
import { BotListItem, botRowProps } from "./Sidebar";
import { SidebarBotActivity, crossBotAttentionThreads } from "./SidebarBotActivity";

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/interface-mode", async (original) => ({
  ...await original<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => true,
}));

const entry = (id: string, read: boolean): NotificationLogEntry => ({
  id, at: 1, read, kind: "done", botId: "atlas", botName: "Atlas", threadId: "t", title: "Atlas finished", body: "",
});
const bot = (overrides: Partial<Bot> = {}): Bot => ({
  id: "atlas", threadId: "thread-atlas", name: "Atlas", title: "", description: "", notifications: true, color: "green",
  unread: false, modelSelection: { instanceId: "claude", model: "test" }, messages: [], ...overrides,
});
const store = (children: unknown) => createElement(BotEditorStore, {
  value: { state: { ...initialState, notifications: [entry("a", false), entry("b", false)] }, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} },
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

describe("unread indicators with the real preference store", () => {
  it("hides and restores the bell count live as the preference changes", async () => {
    await act(async () => root.render(store(createElement(NotificationRail))));
    expect(container.innerHTML).toContain("2 unread");
    await act(async () => setUnreadIndicators(false));
    expect(container.innerHTML).not.toContain("unread");
    await act(async () => setUnreadIndicators(true));
    expect(container.innerHTML).toContain("2 unread");
  });

  it("hides and restores a bot row's unread dot, leaving the waiting dot", async () => {
    const row = (candidate: Bot) => store(createElement(BotListItem, botRowProps(initialState, vi.fn(), candidate, { density: "comfortable", quiet: false, query: "", onMenu: vi.fn() })));
    await act(async () => root.render(row(bot({ unread: true }))));
    expect(container.innerHTML).toContain("Unread threads");
    await act(async () => setUnreadIndicators(false));
    expect(container.innerHTML).not.toContain("Unread threads");
    await act(async () => root.render(row(bot({ unread: true, activity: "waiting-on-you" }))));
    expect(container.innerHTML).toContain('data-testid="waiting-dot"');
  });

  it("drops unread-only threads from the attention list and inline sub-rows but keeps waiting, working and queued ones", async () => {
    const tasks = [
      { threadId: "u", title: "Only unread", createdAt: 1, unread: true },
      { threadId: "w", title: "Waiting", createdAt: 2, activity: "waiting-on-you" as const },
      { threadId: "k", title: "Working", createdAt: 3, busy: true },
      { threadId: "q", title: "Queued", createdAt: 4 },
    ];
    const withTasks = bot({ tasks });
    const queued = { q: [{ queueId: "1", text: "x" }] };
    const ids = (showUnread: boolean) => crossBotAttentionThreads([withTasks], queued, undefined, [], showUnread).map((e) => e.task.threadId).sort();
    expect(ids(true)).toEqual(["k", "q", "u", "w"]);
    expect(ids(false)).toEqual(["k", "q", "w"]);

    const inline = createElement(SidebarBotActivity, { bot: withTasks, rowThreadId: "none", density: "comfortable", pendingQueued: queued, dispatch: vi.fn() });
    await act(async () => root.render(inline));
    expect(container.textContent).toContain("Only unread");
    await act(async () => setUnreadIndicators(false));
    expect(container.textContent).not.toContain("Only unread");
    for (const title of ["Waiting", "Working", "Queued"]) expect(container.textContent).toContain(title);
  });
});
