// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TalkShortcutState } from "../../electron/talk-shortcut.mjs";
import { setLocale } from "@/lib/i18n";
import { TalkShortcutRow } from "./TalkShortcutRow";

const KEYS: TalkShortcutState["keys"] = [
  { id: "ctrl-opt-space", label: "⌃⌥Space" },
  { id: "ctrl-shift-space", label: "⌃⇧Space" },
  { id: "opt-shift-space", label: "⌥⇧Space" },
];
const base: TalkShortcutState = { available: true, enabled: true, key: "ctrl-opt-space", keys: KEYS, taken: false };
let current: TalkShortcutState;
let bridge: { state: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
let host: HTMLDivElement;
let root: Root;

const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
const show = async () => { await act(async () => { root.render(createElement(TalkShortcutRow)); }); await settle(); };
const toggle = () => host.querySelector<HTMLButtonElement>('button[aria-label="Talk to MausBot from any app"]')!;
const click = async (element: HTMLElement) => { await act(async () => { element.click(); }); await settle(); };

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  current = { ...base };
  bridge = {
    state: vi.fn(async () => current),
    set: vi.fn(async (change: Partial<TalkShortcutState>) => (current = { ...current, ...change })),
  };
  (window as unknown as { ogb: unknown }).ogb = { talkShortcut: bridge };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  delete (window as unknown as { ogb?: unknown }).ogb;
  vi.unstubAllGlobals();
});

describe("TalkShortcutRow", () => {
  it("is not shown without the bridge or where Apple speech is unavailable", async () => {
    (window as unknown as { ogb: unknown }).ogb = {};
    await show();
    expect(host.textContent).toBe("");
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    (window as unknown as { ogb: unknown }).ogb = { talkShortcut: bridge };
    current = { ...base, available: false };
    await show();
    expect(host.textContent).toBe("");
  });

  it("shows the switch on with the key in its subtitle, and turns it off", async () => {
    await show();
    expect(host.textContent).toContain("Talk to MausBot from any app");
    expect(host.textContent).toContain("Hold ⌃⌥Space, speak, let go");
    await click(toggle());
    expect(bridge.set).toHaveBeenCalledWith({ enabled: false });
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector("select")).toBeNull();
  });

  it("changes the key and says so", async () => {
    await show();
    const select = host.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "ctrl-shift-space");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(bridge.set).toHaveBeenCalledWith({ key: "ctrl-shift-space" });
    expect(host.textContent).toContain("Hold ⌃⇧Space");
  });

  it("says when another app holds the key", async () => {
    current = { ...base, taken: true };
    await show();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("⌃⌥Space is used by another app. Pick another shortcut.");
  });
});
