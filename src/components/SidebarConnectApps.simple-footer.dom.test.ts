// @vitest-environment happy-dom
// A dismissed pill must leave a reachable Apps entry in the Simple footer and rail. These tests mount the compositions
// that actually ship (SidebarFooter in Simple mode, SimpleRailFooter) while dismissed: a sibling mount of the pill is
// what let a previous version pass while the entry disappeared from the sidebar.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dismissConnectAppsPill, restoreConnectAppsPill } from "@/lib/connect-apps-pill";

const fixture = vi.hoisted(() => ({
  inventory: { services: { gmail: { connected: true } } as Record<string, { connected: boolean }>, authoritative: true },
  catalogue: { cards: new Map<string, unknown>(), slugs: ["gmail", "slack"] as string[], complete: true },
  native: [] as Array<{ slug: string; connected: boolean }>,
  advanced: false,
  pluginsOpen: false,
  dispatch: vi.fn(),
}));

vi.mock("@/state/store", () => ({
  useStore: () => ({ state: { pluginsOpen: fixture.pluginsOpen }, dispatch: fixture.dispatch }),
}));
vi.mock("./CloudUsageMeter", () => ({ CloudUsageCard: () => null }));
vi.mock("./DesktopWorkspaceSwitcher", () => ({ endCloudHowTo: vi.fn(), useWorkspacePlace: () => ({ error: null, waking: null }) }));
vi.mock("./SidebarProfileMenu", () => ({ SidebarProfileMenu: () => null, useSimpleAccount: () => ({}) }));
vi.mock("./UpdateIndicator", () => ({ UpdateIndicator: () => null }));
vi.mock("./SidebarFooterNav", () => ({ SidebarBottomButtons: () => null, SidebarFooterNav: () => null }));
vi.mock("./SidebarPhoneButton", () => ({ SidebarPhoneButton: () => null, phoneSettingsAction: () => ({ type: "phone-settings" }) }));
vi.mock("./PluginsPanel", () => ({ preloadConnectedApps: () => Promise.resolve(fixture.inventory) }));
vi.mock("./bot-settings/useBotApps", () => ({ loadAppCatalogue: () => Promise.resolve(fixture.catalogue) }));
vi.mock("@/lib/native-app-connections", () => ({ loadNativeAppConnections: () => Promise.resolve(fixture.native) }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced }));

const { SidebarFooter } = await import("./SidebarFooter");
const { SimpleRailFooter } = await import("./SidebarSimpleRail");
const { ConnectAppsPillRestore } = await import("./ConnectAppsPillRestore");

let host: HTMLDivElement;
let root: Root;

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => { values.clear(); },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
  };
}

const storage = memoryStorage();

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  storage.clear();
  fixture.inventory = { services: { gmail: { connected: true } }, authoritative: true };
  fixture.catalogue = { cards: new Map(), slugs: ["gmail", "slack"], complete: true };
  fixture.native = [];
  fixture.advanced = false;
  fixture.pluginsOpen = false;
  fixture.dispatch.mockClear();
  restoreConnectAppsPill();
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  restoreConnectAppsPill();
});

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const pill = () => host.querySelector<HTMLElement>("[data-connect-apps-pill]");
const compact = () => host.querySelector<HTMLElement>("[data-connect-apps-compact]");
const dismiss = () => host.querySelector<HTMLElement>("[data-connect-apps-dismiss]");

function renderFooter() {
  flushSync(() => root.render(createElement(SidebarFooter, { density: "compact", simple: true, owner: null, toolsCollapsed: false })));
}

describe("the Apps entry a dismissal leaves in the shipping Simple footer", () => {
  it("replaces the labelled pill with a 36px icon button in the same slot, and the button opens the panel", async () => {
    renderFooter();
    await settle();
    expect(pill()).not.toBeNull();
    expect(dismiss()!.className).toContain("size-6");

    flushSync(() => dismiss()!.click());
    await settle();
    expect(pill()).toBeNull();

    const entry = compact()!;
    expect(entry).not.toBeNull();
    expect(host.querySelector('[data-sidebar-footer="simple"]')!.contains(entry)).toBe(true);
    expect(entry.getAttribute("aria-label")).toBe("Connect apps");
    expect(entry.getAttribute("data-tour")).toBe("nav-apps");
    expect(entry.getAttribute("data-sidebar-nav")).toBe("apps");
    expect(entry.className).toContain("size-9");

    flushSync(() => entry.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "togglePlugins", open: true });
  });

  it("renders the compact button on a mount that starts dismissed", async () => {
    dismissConnectAppsPill();
    renderFooter();
    await settle();
    expect(pill()).toBeNull();
    expect(compact()).not.toBeNull();
  });

  it("puts focus on the compact button after dismissing, not on the body", async () => {
    renderFooter();
    await settle();
    flushSync(() => dismiss()!.click());
    await settle();
    expect(document.activeElement).toBe(compact());
  });

  it("puts focus back on the labelled pill when the panel's control restores it", async () => {
    flushSync(() => root.render(createElement("div", null,
      createElement(SidebarFooter, { density: "compact", simple: true, owner: null, toolsCollapsed: false }),
      createElement(ConnectAppsPillRestore),
    )));
    await settle();
    flushSync(() => dismiss()!.click());
    await settle();
    expect(document.activeElement).toBe(compact());

    const restore = host.querySelector<HTMLElement>("[data-show-connect-apps]")!;
    expect(restore).not.toBeNull();
    flushSync(() => restore.click());
    await settle();
    expect(pill()).not.toBeNull();
    expect(document.activeElement).toBe(pill());
  });
});

describe("the Apps entry a dismissal leaves in the shipping Simple rail", () => {
  it("keeps the round 36px button above the update indicator and opens the panel", async () => {
    flushSync(() => root.render(createElement(SimpleRailFooter, { owner: null })));
    await settle();
    flushSync(() => dismiss()!.click());
    await settle();
    expect(pill()).toBeNull();

    const entry = compact()!;
    expect(entry).not.toBeNull();
    const foot = host.querySelector("[data-sidebar-rail-footer]")!;
    expect(foot.contains(entry)).toBe(true);
    expect(entry.getAttribute("aria-label")).toBe("Connect apps");
    expect(entry.className).toContain("size-9");
    expect(entry.className).toContain("rounded-full");
    // One row, in the pill's slot: the button is the rail footer's first child, not an extra row below the account.
    expect(foot.firstElementChild!.contains(entry)).toBe(true);

    flushSync(() => entry.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "togglePlugins", open: true });
  });
});

describe("the restore control belongs to Simple mode", () => {
  it("is absent in Advanced mode, where no sidebar pill exists to bring back", () => {
    dismissConnectAppsPill();
    fixture.advanced = true;
    flushSync(() => root.render(createElement(ConnectAppsPillRestore)));
    expect(host.querySelector("[data-show-connect-apps]")).toBeNull();

    fixture.advanced = false;
    flushSync(() => root.render(createElement(ConnectAppsPillRestore)));
    expect(host.querySelector("[data-show-connect-apps]")).not.toBeNull();
  });
});
