// @vitest-environment happy-dom
// The approval menu's Command allowlist row: it follows Full access, it stays
// reachable while every mode is unavailable, and picking it never changes the
// approval mode. Driven through the real menu (the shared PopoverMenu), so the
// row order and the closing-on-pick are the ones a person gets.
import { createElement, type ComponentProps } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApprovalModeSelector } from "./ApprovalModeSelector";

let host: HTMLDivElement;
let root: Root;

/** The open popover menu sheet, if any. */
const menu = () => document.querySelector<HTMLElement>("[data-popover-menu]");
/** Text content of the open menu, for order assertions. */
const menuText = () => menu()?.textContent ?? "";
/** The approval-mode trigger button in the test host. */
const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
/** All menu rows of the given role in the open sheet. */
const rows = (role: "menuitem" | "menuitemradio") => [...document.querySelectorAll<HTMLButtonElement>(`[role="${role}"]`)];
/** Picks a radio row by its leading label text. */
const pick = (label: string) => flushSync(() => {
  rows("menuitemradio").find((row) => row.textContent?.startsWith(label))!.click();
});
/** Mounts fresh and opens the menu: the trigger toggles, so each call starts
 * from a closed menu rather than flipping the previous one shut. */
const open = (props: Partial<ComponentProps<typeof ApprovalModeSelector>> = {}) => {
  flushSync(() => root.unmount());
  root = createRoot(host);
  flushSync(() => root.render(createElement(ApprovalModeSelector, {
    providerName: "Codex", driverKind: "codex", approvalMode: "ask", onSelect: () => {}, ...props,
  })));
  flushSync(() => trigger().click());
};

beforeEach(() => {
  document.documentElement.dataset.reducedMotion = "true";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.reducedMotion;
});

describe("command allowlist menu access", () => {
  it("places the management action after Full access and opens it without changing approval mode", () => {
    const select = vi.fn(), manage = vi.fn();
    open({ onSelect: select, onManageCommandAllowlist: manage });
    expect(menuText().indexOf("Full access")).toBeLessThan(menuText().indexOf("Command allowlist"));
    expect(menuText().indexOf("Command allowlist")).toBeLessThan(menuText().indexOf("Custom (config.toml)"));
    flushSync(() => rows("menuitem").find((row) => row.textContent?.includes("Command allowlist"))!.click());
    expect(manage).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
    expect(menu()).toBeNull();
  });

  it("leaves Full access selection on its existing callback", () => {
    const select = vi.fn(), manage = vi.fn();
    open({ onSelect: select, onManageCommandAllowlist: manage });
    pick("Full access");
    expect(select).toHaveBeenCalledExactlyOnceWith("full");
    expect(manage).not.toHaveBeenCalled();
  });

  it("offers Full access without the desktop bridge and sends only Custom to the desktop app", () => {
    const select = vi.fn();
    open({ onSelect: select, trustedModesAvailable: false });
    expect(menuText()).not.toContain("Custom (config.toml)");
    expect(menuText()).toContain("Custom approval must be changed in the local packaged desktop app.");
    expect(menuText()).not.toContain("Full and Custom are available in the packaged desktop app.");
    pick("Full access");
    expect(select).toHaveBeenCalledExactlyOnceWith("full");
  });

  it("offers the action without trusted modes, and omits it when the caller lacks management authority", () => {
    open({ onManageCommandAllowlist: vi.fn(), trustedModesAvailable: false });
    expect(menuText()).toContain("Command allowlist");
    open();
    expect(menuText()).not.toContain("Command allowlist");
  });

  it("allows command management while busy while keeping every mode unavailable", () => {
    const select = vi.fn(), manage = vi.fn();
    open({ onSelect: select, onManageCommandAllowlist: manage, disabled: true });
    // The trigger stays live so the allowlist stays reachable; the modes do
    // not (a disabled row is skipped by the arrows and takes no click).
    expect(trigger().disabled).toBe(false);
    const modes = rows("menuitemradio");
    expect(modes.length).toBeGreaterThan(0);
    for (const mode of modes) expect(mode.disabled).toBe(true);
    flushSync(() => rows("menuitem").find((row) => row.textContent?.includes("Command allowlist"))!.click());
    expect(manage).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
    // Without a management action there is nothing to reach while busy.
    open({ disabled: true });
    expect(trigger().disabled).toBe(true);
  });
});
