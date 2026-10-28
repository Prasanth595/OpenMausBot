// @vitest-environment happy-dom
// The Apps panel is the way back from a dismissed sidebar pill. Without this control the preference would be a
// one-way door, so the panel itself must offer it and clear the saved flag at once.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONNECT_APPS_PILL_KEY, connectAppsPillDismissed, dismissConnectAppsPill } from "@/lib/connect-apps-pill";

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

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, bots: [], instances: [], pluginsOpen: true, pluginsSurface: "apps" },
      dispatch: vi.fn(),
    }),
    api: vi.fn(async (path: string) => {
      if (path === "/api/connectors/connected") return { services: {}, credentialStore: "ok", inventoryComplete: true };
      if (path === "/api/connectors/catalog") return { cards: [], configured: true, mode: "unavailable", source: "curated" };
      return {};
    }),
  };
});
vi.mock("./McpServersPanel", () => ({ McpServersPanel: () => null }));
vi.mock("./XCard", () => ({ X_CARD_SEARCH: "", XCard: () => null }));
vi.mock("./HighLevelCard", () => ({ HighLevelCard: () => null }));

const { PluginsPanel } = await import("./PluginsPanel");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("the Apps panel's way back to the Connect apps pill", () => {
  it("offers the control only while the pill is dismissed, and restores it at once", async () => {
    dismissConnectAppsPill();
    expect(window.localStorage.getItem(CONNECT_APPS_PILL_KEY)).toBe("1");

    flushSync(() => root.render(createElement(PluginsPanel)));
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));

    const restore = document.body.querySelector<HTMLElement>("[data-show-connect-apps]");
    expect(restore).not.toBeNull();
    expect(restore!.textContent).toContain("Show Connect apps in the sidebar");

    flushSync(() => restore!.click());
    expect(connectAppsPillDismissed()).toBe(false);
    expect(window.localStorage.getItem(CONNECT_APPS_PILL_KEY)).toBeNull();
    expect(document.body.querySelector("[data-show-connect-apps]")).toBeNull();
  });

  it("adds nothing to the panel when the pill was never dismissed", async () => {
    flushSync(() => root.render(createElement(PluginsPanel)));
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.querySelector("[data-show-connect-apps]")).toBeNull();
  });
});
