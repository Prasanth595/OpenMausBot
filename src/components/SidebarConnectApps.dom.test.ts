// @vitest-environment happy-dom
// The sidebar's Connect apps pill may only leave once the server reports a complete inventory with every app on it
// already connected. An unknown or partial inventory keeps it, because a hidden pill must never mean a hidden problem.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  inventory: { services: {}, authoritative: true } as {
    services: Record<string, { connected: boolean; pending?: boolean }>;
    authoritative: boolean;
  },
}));

vi.mock("@/state/store", () => ({ useStore: () => ({ state: { pluginsOpen: false }, dispatch: vi.fn() }) }));
vi.mock("./PluginsPanel", () => ({ preloadConnectedApps: () => Promise.resolve(fixture.inventory) }));
vi.mock("./bot-settings/useBotApps", () => ({ loadAppCards: () => Promise.resolve(new Map()) }));

const { SidebarConnectApps } = await import("./SidebarConnectApps");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fixture.inventory = { services: {}, authoritative: true };
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const pill = () => host.querySelector('[data-sidebar-nav="apps"]');

describe("the Connect apps pill with a known inventory", () => {
  it("is there while the inventory is still unknown", async () => {
    fixture.inventory = { services: { gmail: { connected: true } }, authoritative: true };
    flushSync(() => root.render(createElement(SidebarConnectApps)));
    expect(pill()).not.toBeNull();
    await settle();
  });

  it("leaves when every app is connected and the inventory is complete", async () => {
    fixture.inventory = { services: { gmail: { connected: true }, slack: { connected: true } }, authoritative: true };
    flushSync(() => root.render(createElement(SidebarConnectApps)));
    await settle();
    expect(pill()).toBeNull();
  });

  it("stays when an app is still unconnected", async () => {
    fixture.inventory = { services: { gmail: { connected: true }, slack: { connected: false } }, authoritative: true };
    flushSync(() => root.render(createElement(SidebarConnectApps)));
    await settle();
    expect(pill()).not.toBeNull();
  });

  it("stays when the server could not read the full inventory, even if everything it listed is connected", async () => {
    fixture.inventory = { services: { gmail: { connected: true }, slack: { connected: true } }, authoritative: false };
    flushSync(() => root.render(createElement(SidebarConnectApps)));
    await settle();
    expect(pill()).not.toBeNull();
  });

  it("stays on the collapsed rail too while an app is unconnected", async () => {
    fixture.inventory = { services: { gmail: { connected: false } }, authoritative: true };
    flushSync(() => root.render(createElement(SidebarConnectApps, { circle: true })));
    await settle();
    expect(pill()).not.toBeNull();
  });
});
