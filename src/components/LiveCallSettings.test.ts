// @vitest-environment happy-dom
// The call bar's gear and its settings menu (the shared PopoverMenu): a real
// click opens the sheet, so the rows proved here are the ones a person sees.
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "@/state/store";

const fixture = vi.hoisted(() => ({
  live: { configured: false, voice: "marin", readTypedReplies: true, idleMinutes: 5 },
  cloudHome: false,
  dispatch: vi.fn(),
  calls: [] as Array<{ path: string; body: unknown }>,
  refuse: null as string | null,
}));

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, config: { cloudHome: fixture.cloudHome, live: fixture.live } as AppState["config"] },
      dispatch: fixture.dispatch,
    }),
  };
});

const { LiveCallSettings } = await import("./LiveCallSettings");

/** The bar's own state, so a row that closes the menu really closes it. */
function Harness() {
  const [open, setOpen] = useState(false);
  return createElement(LiveCallSettings, { open, onOpenChange: setOpen, triggerClassName: "gear" });
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.documentElement.dataset.reducedMotion = "true";
  fixture.live = { configured: false, voice: "marin", readTypedReplies: true, idleMinutes: 5 };
  fixture.cloudHome = false;
  fixture.calls = [];
  fixture.refuse = null;
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (init?.method) fixture.calls.push({ path, body });
    if (fixture.refuse && path === "/api/live/settings") {
      return { ok: false, status: 500, statusText: "Server Error", json: async () => ({ error: fixture.refuse }) };
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => ({ live: fixture.live }) };
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.reducedMotion;
  vi.unstubAllGlobals();
});

const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-label="Call settings"]')!;
const rows = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')];
const row = (text: string) => rows().find((candidate) => (candidate.textContent ?? "").includes(text));
/** The choices of the submenu a parent row opened. */
const subRows = () => [...document.querySelectorAll<HTMLElement>('[data-popover-submenu] [role="menuitemradio"]')];
const words = () => document.body.textContent ?? "";
const saved = () => fixture.calls.filter((call) => call.path === "/api/live/settings").at(-1);

/** Mounts the gear and opens its settings menu with a real click. */
const open = () => {
  act(() => root.render(createElement(Harness)));
  act(() => trigger().click());
};

describe("the call settings menu", () => {
  it("offers voice, typed replies, idle minutes and the key, defaulting to five minutes", () => {
    open();
    expect(row("Voice")!.textContent).toContain("Marin (default)");
    expect(words()).toContain("A new voice starts with the next call.");
    expect(row("Read replies to typed messages")!.getAttribute("aria-checked")).toBe("true");
    expect(words()).toContain("When this is off, messages you type during a call and the bot's answers to them are not sent to OpenAI.");
    expect(row("Hang up after this many minutes of silence")!.textContent).toContain("5");
    expect(words()).toContain("OpenAI key");
    expect(row("Change key")).toBeDefined();
    expect(row("Remove key")).toBeUndefined();
    expect(words()).toContain("The OpenAI key stays on your computer.");
    expect(words()).toContain("about $0.05 per minute");
  });

  it("says the key stays on the Cloud when the chat is on the person's Cloud", () => {
    fixture.cloudHome = true;
    open();
    expect(words()).toContain("The OpenAI key stays on My Cloud.");
    expect(words()).not.toContain("stays on your computer");
  });

  it("picks a voice from its submenu, and stays open to show the choice", () => {
    open();
    act(() => row("Voice")!.click());
    expect(subRows().find((candidate) => candidate.textContent === "Marin (default)")!.getAttribute("aria-checked")).toBe("true");
    act(() => subRows().find((candidate) => candidate.textContent === "Cedar")!.click());
    expect(saved()).toMatchObject({ body: { voice: "cedar" } });
    expect(row("Cedar")).toBeDefined();
  });

  it("picks the idle minutes from its submenu", () => {
    open();
    act(() => row("Hang up after this many minutes of silence")!.click());
    act(() => rows().find((candidate) => candidate.textContent === "10")!.click());
    expect(saved()).toMatchObject({ body: { idleMinutes: 10 } });
  });

  it("flips typed replies in place, without closing the menu", () => {
    open();
    act(() => row("Read replies to typed messages")!.click());
    expect(saved()).toMatchObject({ body: { readTypedReplies: false } });
    expect(row("Read replies to typed messages")).toBeDefined();
  });

  it("shows the key form under Change key, with the menu still open", () => {
    open();
    act(() => row("Change key")!.click());
    expect(document.body.querySelector('input[aria-label="OpenAI API key for Live calls"]')).not.toBeNull();
    expect(row("Change key")).toBeDefined();
  });

  it("removes a stored key, offered only once one is configured", () => {
    fixture.live = { ...fixture.live, configured: true };
    open();
    act(() => row("Remove key")!.click());
    expect(fixture.calls.at(-1)).toMatchObject({ path: "/api/config", body: { live: { key: "" } } });
  });

  it("says so in the menu when a save fails", async () => {
    fixture.refuse = "The settings could not be saved";
    open();
    await act(async () => { row("Read replies to typed messages")!.click(); });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("The settings could not be saved");
    expect(row("Read replies to typed messages")).toBeDefined();
  });
});
