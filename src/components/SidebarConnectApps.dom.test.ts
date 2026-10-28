// @vitest-environment happy-dom
// The sidebar's Connect apps pill may only leave once the whole catalogue is connected, not merely every app in the
// connected-only inventory. An unknown, empty or partial catalogue keeps it, because a hidden pill must never mean a
// hidden problem. It starts hidden so a fully connected sidebar never paints it and then removes it.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECT_APPS_PILL_KEY, restoreConnectAppsPill } from "@/lib/connect-apps-pill";

type ConnectorState = { connected: boolean; pending?: boolean };

const fixture = vi.hoisted(() => ({
  inventory: { services: {} as Record<string, ConnectorState>, authoritative: true },
  catalogue: { cards: new Map<string, unknown>(), slugs: [] as string[], complete: true },
  native: [
    { slug: "whop", connected: true },
    { slug: "highlevel", connected: true },
    { slug: "x", connected: true },
  ] as Array<{ slug: string; connected: boolean }>,
  pluginsOpen: false,
}));

vi.mock("@/state/store", () => ({ useStore: () => ({ state: { pluginsOpen: fixture.pluginsOpen }, dispatch: vi.fn() }) }));
vi.mock("./PluginsPanel", () => ({ preloadConnectedApps: () => Promise.resolve(fixture.inventory) }));
vi.mock("./bot-settings/useBotApps", () => ({ loadAppCatalogue: () => Promise.resolve(fixture.catalogue) }));
vi.mock("@/lib/native-app-connections", () => ({ loadNativeAppConnections: () => Promise.resolve(fixture.native) }));

const { SidebarConnectApps } = await import("./SidebarConnectApps");
const { ConnectAppsPillRestore } = await import("./ConnectAppsPillRestore");

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
  fixture.pluginsOpen = false;
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
  restoreConnectAppsPill();
  window.localStorage.clear();
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function memoryStorage(failWrites = false): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => { values.clear(); },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error("storage blocked");
      values.set(key, String(value));
    },
  };
}

const pill = () => host.querySelector<HTMLElement>("[data-connect-apps-pill]");
const compact = () => host.querySelector<HTMLElement>("[data-connect-apps-compact]");
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

  it("stays when a partial catalogue hides slugs it could not page in", async () => {
    // Without the complete guard this hides the pill: every named app is connected and the list looks finished.
    fixture.inventory = { services: { gmail: { connected: true }, slack: { connected: true } }, authoritative: true };
    fixture.catalogue = { cards: new Map(), slugs: ["gmail", "slack"], complete: false };
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

describe("dismissing the Connect apps pill", () => {
  const renderWithRestore = () => flushSync(() => root.render(createElement("div", null,
    createElement(SidebarConnectApps),
    createElement(ConnectAppsPillRestore),
  )));

  it("hides at once, survives a restart, and the panel control brings it back", async () => {
    fixture.inventory = { services: { gmail: { connected: true } }, authoritative: true };
    fixture.catalogue = { cards: new Map(), slugs: ["gmail", "slack"], complete: true };
    renderWithRestore();
    await settle();
    expect(shown()).not.toBeNull();

    const dismiss = host.querySelector<HTMLElement>("[data-connect-apps-dismiss]")!;
    expect(dismiss.getAttribute("aria-label")).toBe("Hide Connect apps");
    // A sibling of the pill, never inside it, so the main click stays the main click.
    expect(pill()!.contains(dismiss)).toBe(false);
    flushSync(() => dismiss.click());
    expect(pill()).toBeNull();
    // The entry stays: an icon-only button in the slot the pill occupied, never nothing.
    expect(compact()).not.toBeNull();
    expect(window.localStorage.getItem(CONNECT_APPS_PILL_KEY)).toBe("1");

    // A fresh mount is the restart: the saved flag must still hold.
    flushSync(() => root.unmount());
    root = createRoot(host);
    renderWithRestore();
    await settle();
    expect(compact()).not.toBeNull();
    expect(pill()).toBeNull();

    const restore = host.querySelector<HTMLElement>("[data-show-connect-apps]");
    expect(restore).not.toBeNull();
    flushSync(() => restore!.click());
    expect(shown()).not.toBeNull();
    expect(window.localStorage.getItem(CONNECT_APPS_PILL_KEY)).toBeNull();
  });

  it("offers the dismiss control on the collapsed rail as well", async () => {
    fixture.inventory = { services: { gmail: { connected: true } }, authoritative: true };
    fixture.catalogue = { cards: new Map(), slugs: ["gmail", "notion"], complete: true };
    flushSync(() => root.render(createElement(SidebarConnectApps, { circle: true })));
    await settle();
    const dismiss = host.querySelector<HTMLElement>("[data-connect-apps-dismiss]");
    expect(dismiss?.getAttribute("aria-label")).toBe("Hide Connect apps");
    flushSync(() => dismiss!.click());
    expect(pill()).toBeNull();
    expect(compact()?.getAttribute("aria-label")).toBe("Connect apps");
  });

  it("keeps the pill settled on a fresh mount while the panel is already open", () => {
    fixture.pluginsOpen = true;
    fixture.inventory = { services: { gmail: { connected: true } }, authoritative: true };
    fixture.catalogue = { cards: new Map(), slugs: ["gmail", "slack"], complete: true };
    flushSync(() => root.render(createElement(SidebarConnectApps)));
    expect(shown()).not.toBeNull();
  });
});
