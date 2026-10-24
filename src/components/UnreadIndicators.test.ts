import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BotEditorStore, initialState, type Bot } from "@/state/store";
import type { NotificationLogEntry } from "../../shared/notification";

const fixture = vi.hoisted(() => ({ on: true }));
vi.mock("@/lib/notification-preferences", async (original) => ({
  ...await original<typeof import("@/lib/notification-preferences")>(),
  useUnreadIndicators: () => fixture.on,
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));
vi.mock("@/lib/interface-mode", async (original) => ({
  ...await original<typeof import("@/lib/interface-mode")>(),
  useAdvancedMode: () => true,
}));

import { NotificationRail } from "./NotificationsPanel";
import { UnreadIndicatorsRow } from "./NotificationSettingsRows";
import { BotListItem, botRowProps } from "./Sidebar";

const entry = (id: string, read: boolean): NotificationLogEntry => ({
  id, at: 1, read, kind: "done", botId: "atlas", botName: "Atlas", threadId: "t", title: "Atlas finished", body: "",
});
const bot = (overrides: Partial<Bot> = {}): Bot => ({
  id: "atlas", threadId: "thread-atlas", name: "Atlas", title: "", description: "", notifications: true, color: "green",
  unread: false, modelSelection: { instanceId: "claude", model: "test" }, messages: [], ...overrides,
});

const rail = () => {
  const state = { ...initialState, notifications: [entry("a", false), entry("b", false), entry("c", true)] };
  const value = { state, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  return renderToStaticMarkup(createElement(BotEditorStore, { value, children: createElement(NotificationRail) }));
};
const row = (candidate: Bot) =>
  renderToStaticMarkup(createElement(BotListItem, botRowProps(initialState, vi.fn(), candidate, { density: "comfortable", quiet: false, query: "", onMenu: vi.fn() })));

beforeEach(() => { fixture.on = true; });

describe("unread indicators switch", () => {
  it("counts unread on the notifications button while on and hides the count while off", () => {
    expect(rail()).toContain("2 unread");
    fixture.on = false;
    const off = rail();
    expect(off).not.toContain("unread");
    expect(off).toContain('aria-label="Notifications"');
  });

  it("marks an unread bot with a dot while on and not while off, never hiding an approval wait", () => {
    expect(row(bot({ unread: true }))).toContain('aria-label="Unread threads"');
    fixture.on = false;
    expect(row(bot({ unread: true }))).not.toContain("Unread threads");
    expect(row(bot({ unread: true, activity: "waiting-on-you" }))).toContain('data-testid="waiting-dot"');
  });

  it("renders the setting as a switch that is on by default", () => {
    expect(renderToStaticMarkup(createElement(UnreadIndicatorsRow))).toContain('aria-checked="true"');
    fixture.on = false;
    expect(renderToStaticMarkup(createElement(UnreadIndicatorsRow))).toContain('aria-checked="false"');
  });
});
