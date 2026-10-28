// @vitest-environment happy-dom
// The sidebar's Connect apps pill may only leave once the whole catalogue is connected, not merely every app in the
// connected-only inventory. An unknown, empty or partial catalogue keeps it, because a hidden pill must never mean a
// hidden problem. It starts hidden so a fully connected sidebar never paints it and then removes it.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ConnectorState = { connected: boolean; pending?: boolean };

const fixture = vi.hoisted(() => ({
  inventory: { services: {} as Record<string, ConnectorState>, authoritative: true },
  catalogue: { cards: new Map<string, unknown>(), slugs: [] as string[], complete: true },
  native: [
    { slug: "whop", connected: true },
    { slug: "highlevel", connected: true },
    { slug: "x", connected: true },
  ] as Array<{ slug: string; connected: boolean }>,
}));

vi.mock("@/state/store", () => ({ useStore: () => ({ state: { pluginsOpen: false }, dispatch: vi.fn() }) }));
vi.mock("./PluginsPanel", () => ({ preloadConnectedApps: () => Promise.resolve(fixture.inventory) }));
vi.mock("./bot-settings/useBotApps", () => ({ loadAppCatalogue: () => Promise.resolve(fixture.catalogue) }));
vi.mock("@/lib/native-app-connections", () => ({ loadNativeAppConnections: () => Promise.resolve(fixture.native) }));

const { SidebarConnectApps } = await import("./SidebarConnectApps");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fixture.inventory = { services: {}, authoritative: true };
  fixture.catalogue = { cards: new Map(), slugs: [], complete: true };
  fixture.native = [
    { slug: "whop", connected: true },
    { slug: "highlevel", connected: true },
    { slug: "x", connected: true },
  ];
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const pill = () => host.querySelector<HTMLElement>('[data-sidebar-nav="apps"]');
/** The pill only counts as shown once it is in the tree without the hidden attribute. */
const shown = () => {
  const element = pill();
  return element && !element.hasAttribute("hidden") ? element : null;
};

describe("the Connect apps pill against the catalogue", () => {
  it("starts hidden and stays hidden for a fully connected workspace, with no flash", async () => {
    fixture.inventory = { services: { gmail: { connected: true }, slack: { connected: true }, notion: { connected: true } }, authoritative: true };
    fixture.catalogue = { cards: new Map(), slugs: ["gmail", "slack", "notion"], complete: true };
    flushSync(() => root.render(createElement(SidebarConnectApps)));
    expect(pill()).not.toBeNull();
    expect(pill()!.hasAttribute("hidden")).toBe(true);
    expect(shown()).toBeNull();
    await settle();
    expect(pill()).toBeNull();
  });

  it("starts hidden and appears once an app is still unconnected", async () => {
    fixture.inventory = { services: { gmail: { connected: true } }, authoritative: true };
    fixture.catalogue = { cards: new Map(), slugs: ["gmail", "slack"], complete: true };
    flushSync(() => root.render(createElement(SidebarConnectApps)));
    expect(shown()).toBeNull();
    await settle();
    expect(shown()).not.toBeNull();
  });

  it("stays when one app is connected and the catalogue names others", async () => {
    // The exact shape the connected-only endpoint returns for a person who connected Gmail alone.
    fixture.inventory = { services: { gmail: { connected: true } }, authoritative: true };
    fixture.catalogue = { cards: new Map(), slugs: ["gmail", "slack", "notion"], complete: true };
    flushSync(() => root.render(createElement(SidebarConnectApps)));
    await settle();
    expect(shown()).not.toBeNull();
  });

  it("leaves when every catalogue app and every native app is connected", async () => {
    fixture.inventory = { services: { gmail: { connected: true }, slack: { connected: true } }, authoritative: true };
    fixture.catalogue = { cards: new Map(), slugs: ["gmail", "slack"], complete: true };
    flushSync(() => root.render(createElement(SidebarConnectApps)));
    await settle();
    expect(pill()).toBeNull();
  });

  it("stays when a native app outside the catalogue is not connected", async () => {
    fixture.inventory = { services: { gmail: { connected: true }, slack: { connected: true } }, authoritative: true };
    fixture.catalogue = { cards: new Map(), slugs: ["gmail", "slack"], complete: true };
    fixture.native = [{ slug: "whop", connected: false }, { slug: "highlevel", connected: true }, { slug: "x", connected: true }];
    flushSync(() => root.render(createElement(SidebarConnectApps)));
    await settle();
    expect(shown()).not.toBeNull();
  });

  it("stays when the catalogue is empty", async () => {
    fixture.inventory = { services: { gmail: { connected: true } }, authoritative: true };
    fixture.catalogue = { cards: new Map(), slugs: [], complete: true };
    flushSync(() => root.render(createElement(SidebarConnectApps)));
    await settle();
    expect(shown()).not.toBeNull();
  });

  it("stays when the catalogue could not be read", async () => {
    fixture.inventory = { services: { gmail: { connected: true }, slack: { connected: true } }, authoritative: true };
    fixture.catalogue = { cards: new Map(), slugs: [], complete: false };
    flushSync(() => root.render(createElement(SidebarConnectApps)));
    await settle();
    expect(shown()).not.toBeNull();
  });

  it("stays when the server could not read the full inventory", async () => {
    fixture.inventory = { services: { gmail: { connected: true }, slack: { connected: true } }, authoritative: false };
    fixture.catalogue = { cards: new Map(), slugs: ["gmail", "slack"], complete: true };
    flushSync(() => root.render(createElement(SidebarConnectApps)));
    await settle();
    expect(shown()).not.toBeNull();
  });

  it("stays on the collapsed rail too while an app is unconnected", async () => {
    fixture.inventory = { services: { gmail: { connected: true } }, authoritative: true };
    fixture.catalogue = { cards: new Map(), slugs: ["gmail", "notion"], complete: true };
    flushSync(() => root.render(createElement(SidebarConnectApps, { circle: true })));
    await settle();
    expect(shown()?.getAttribute("aria-label")).toBe("Connect apps");
  });
});
