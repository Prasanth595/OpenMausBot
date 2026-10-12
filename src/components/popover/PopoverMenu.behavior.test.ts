// @vitest-environment happy-dom
// The generic menu in a document: trigger opens a portal sheet, a parent row
// opens a submenu beside it, picking a submenu row runs it and closes
// everything, Escape and an outside press close and return focus.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PopoverMenu, type PopoverMenuItem } from "./PopoverMenu";

describe("PopoverMenu in a document", () => {
  let host: HTMLDivElement;
  let root: Root;
  const picked: string[] = [];
  const item = (key: string, extra: Partial<PopoverMenuItem> = {}): PopoverMenuItem => ({
    key,
    label: key,
    onSelect: () => picked.push(key),
    ...extra,
  });
  const items: PopoverMenuItem[] = [
    item("Usage"),
    item("Help and support", { submenu: [item("Help Center"), item("About")] }),
    item("Settings"),
    item("Account", { separatorBefore: true, value: "Pro" }),
  ];

  const sheet = () => document.querySelector<HTMLElement>("[data-popover-menu]");
  const submenu = () => document.querySelector<HTMLElement>("[data-popover-submenu]");
  const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  const key = async (target: Element, keyName: string) => {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, cancelable: true }));
    });
  };
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    document.documentElement.dataset.reducedMotion = "true";
    picked.length = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(PopoverMenu, { items, ariaLabel: "You", trigger: () => "You" }));
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    delete document.documentElement.dataset.reducedMotion;
  });

  it("portals a styled sheet to the body with divider, value and chevron", async () => {
    await act(async () => trigger().click());
    const menu = sheet()!;
    const surface = menu.closest("[data-popover]") as HTMLElement;
    expect(surface.parentElement).toBe(document.body);
    expect(surface.style.position).toBe("fixed");
    expect(surface.style.width).toBe("280px");
    expect(menu.getAttribute("role")).toBe("group");
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(menu.textContent).toContain("Pro");
    const support = [...menu.querySelectorAll('[role="menuitem"]')].find((node) =>
      node.textContent?.includes("Help and support"),
    )!;
    expect(support.getAttribute("aria-haspopup")).toBe("menu");
    expect(support.querySelector("svg")).not.toBeNull();
    expect(menu.querySelector('[role="menuitem"]')!.className).toContain("min-h-8");
  });

  it("opens from the keyboard on the first item and walks the items", async () => {
    await key(trigger(), "ArrowUp");
    await flush();
    const rows = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(document.activeElement).toBe(rows[0]);
    await key(rows[0]!, "End");
    expect(document.activeElement).toBe(rows[3]);
    await key(rows[3]!, "ArrowDown");
    expect(document.activeElement).toBe(rows[0]);
  });

  it("opens the submenu with the inline end arrow and closes only it with Escape", async () => {
    await act(async () => trigger().click());
    const support = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]!;
    support.focus();
    await key(support, "ArrowRight");
    await flush();
    expect(submenu()).not.toBeNull();
    expect(support.getAttribute("aria-expanded")).toBe("true");
    const first = submenu()!.querySelector<HTMLElement>('[role="menuitem"]')!;
    await act(async () => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(submenu()).toBeNull();
    expect(sheet()).not.toBeNull();
    expect(document.activeElement).toBe(support);
  });

  it("runs a submenu item and closes everything", async () => {
    await act(async () => trigger().click());
    const support = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]!;
    await act(async () => support.click());
    await act(async () => [...submenu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]!.click());
    expect(picked).toEqual(["About"]);
    expect(sheet()).toBeNull();
  });

  it("closes on Escape and gives focus back to the trigger", async () => {
    await act(async () => trigger().click());
    await key(sheet()!, "Escape");
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on a press outside, but not on a press inside the portalled sheet", async () => {
    await act(async () => trigger().click());
    await act(async () => sheet()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(sheet()).not.toBeNull();
    await act(async () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(sheet()).toBeNull();
  });
});
