// @vitest-environment happy-dom
// The generic menu in a document: trigger opens a portal sheet, a parent row
// opens a submenu beside it, picking a submenu row runs it and closes
// everything, Escape and an outside press close and return focus.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PopoverMenu, type PopoverMenuItem } from "./PopoverMenu";
import { MENU_CLOSE_MS } from "../MenuMotion";
import { CLOSE_DELAY_MS, OPEN_DELAY_MS, SUBMENU_OPEN_DELAY_MS } from "./positioning";

// CSS modules resolve to stable names here so open/close state mapping stays
// assertable without reading any concrete animation values.
vi.mock("./popover-motion.module.css", () => ({
  default: { menuIn: "menuIn", menuOut: "menuOut", menuAnimating: "menuAnimating", rowFlow: "rowFlow" },
}));
// Same for the static chrome: assertions only check that a style hook is
// present, never what it computes to. Split per component like the modules.
vi.mock("./popover.module.css", () => ({
  default: {
    root: "root",
    shell: "shell",
    placeAbove: "placeAbove",
    placeBefore: "placeBefore",
    placeAfter: "placeAfter",
    placeBelow: "placeBelow",
    menuShell: "menuShell",
    menuShellBare: "menuShellBare",
    menuInner: "menuInner",
  },
}));
vi.mock("./popover-menu.module.css", () => ({
  default: {
    subInline: "subInline",
    subShell: "subShell",
    subShellBare: "subShellBare",
    subInner: "subInner",
    row: "row",
    rowActive: "rowActive",
    rowIcon: "rowIcon",
    rowIconRoomy: "rowIconRoomy",
    rowIconActive: "rowIconActive",
    rowMain: "rowMain",
    rowTitle: "rowTitle",
    rowSubtitle: "rowSubtitle",
    rowNote: "rowNote",
    rowLabel: "rowLabel",
    rowValue: "rowValue",
    dot: "dot",
    dotAccent: "dotAccent",
    dotDanger: "dotDanger",
    chev: "chev",
    separator: "separator",
    separatorRoomy: "separatorRoomy",
    heading: "heading",
  },
}));

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
    expect(menu.getAttribute("role")).toBe("group");
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(menu.textContent).toContain("Pro");
    const support = [...menu.querySelectorAll('[role="menuitem"]')].find((node) =>
      node.textContent?.includes("Help and support"),
    )!;
    expect(support.getAttribute("aria-haspopup")).toBe("menu");
    expect(support.querySelector("svg")).not.toBeNull();
    expect(menu.querySelector('[role="menuitem"]')!.className).toContain("row");
    // Open state maps to the container enter motion.
    expect(surface.className).toContain("menuIn");
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

  it("lands keyboard focus only after the open finishes", async () => {
    delete document.documentElement.dataset.reducedMotion;
    await key(trigger(), "ArrowDown");
    await flush();
    // Still growing: focus is parked, so the clipping shell cannot
    // scroll-jump under it mid-motion.
    const rows = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(document.activeElement).not.toBe(rows[0]);
    const surface = sheet()!.closest("[data-popover]") as HTMLElement;
    await act(async () => {
      surface.dispatchEvent(new Event("animationend", { bubbles: true }));
    });
    expect(document.activeElement).toBe(rows[0]);
    document.documentElement.dataset.reducedMotion = "true";
  });

  it("gates the inner overflow while growing and restores it when the grow ends", async () => {
    delete document.documentElement.dataset.reducedMotion;
    await act(async () => trigger().click());
    const surface = sheet()!.closest("[data-popover]") as HTMLElement;
    const inner = surface.firstElementChild as HTMLElement;
    expect(inner.style.overflowY).toBe("hidden");
    expect(inner.className).toContain("menuAnimating");
    await act(async () => {
      surface.dispatchEvent(new Event("animationend", { bubbles: true }));
    });
    expect(inner.style.overflowY).toBe("auto");
    expect(inner.className).not.toContain("menuAnimating");
    document.documentElement.dataset.reducedMotion = "true";
  });

  it("staggers rows in reveal order behind the container motion", async () => {
    await act(async () => trigger().click());
    const group = sheet()!;
    expect(group.className).toContain("rowFlow");
    const wrappers = [...group.children] as HTMLElement[];
    expect(wrappers.length).toBeGreaterThan(1);
    // Each row carries its own slots (presence only for the values); custom
    // renderItem rows inherit them from the wrapper.
    for (const wrapper of wrappers) {
      expect(wrapper.style.getPropertyValue("--row-open-d")).not.toBe("");
      expect(wrapper.style.getPropertyValue("--row-close-d")).not.toBe("");
    }
    // Reveal order is direction-independent: the first row leads the open,
    // the last row leads the close. (Relative order only — never concrete
    // delay values.)
    const delay = (wrapper: HTMLElement, prop: string) => Number(wrapper.style.getPropertyValue(prop));
    expect(delay(wrappers[0]!, "--row-open-d")).toBeLessThan(delay(wrappers[wrappers.length - 1]!, "--row-open-d"));
    expect(delay(wrappers[wrappers.length - 1]!, "--row-close-d")).toBeLessThan(delay(wrappers[0]!, "--row-close-d"));
  });

  it("unmounts a select-exit the moment its close animation ends", async () => {
    delete document.documentElement.dataset.reducedMotion;
    await act(async () => trigger().click());
    const rows = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    await act(async () => rows[0]!.click());
    const surface = sheet()!.closest("[data-popover]") as HTMLElement;
    expect(surface.className).toContain("menuOut");
    // No timer wait: the animation finishing is what unmounts.
    await act(async () => {
      surface.dispatchEvent(new Event("animationend", { bubbles: true }));
    });
    expect(sheet()).toBeNull();
    document.documentElement.dataset.reducedMotion = "true";
  });

  it("opens the submenu on hover only after the hover rests", async () => {
    await act(async () => trigger().click());
    const support = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]!;
    await act(async () => {
      support.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    // Still passing through: nothing pops open synchronously.
    await flush();
    expect(submenu()).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SUBMENU_OPEN_DELAY_MS + 50));
    });
    expect(submenu()).not.toBeNull();
  });

  it("does not open a submenu the pointer only brushed past on its way out", async () => {
    await act(async () => trigger().click());
    const support = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]!;
    await act(async () => {
      support.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    // Out of the menu before the hover intent elapses: the leave must cancel
    // the pending open instead of letting it fire behind the pointer.
    await act(async () => {
      support.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SUBMENU_OPEN_DELAY_MS + 50));
    });
    expect(submenu()).toBeNull();
    expect(support.getAttribute("aria-expanded")).not.toBe("true");
    expect(support.className).not.toContain("rowActive");
  });

  it("does not open a submenu when the hover leaves the row into a menu gap", async () => {
    await act(async () => trigger().click());
    const rows = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const support = rows[1]!;
    await act(async () => {
      support.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    // The separator band is a gap inside the menu, not another row and not
    // outside the sheet: the row is left while the menu is not, so only the
    // row's own leave can cancel the pending open.
    const separator = sheet()!.querySelector<HTMLElement>('[role="separator"]')!;
    await act(async () => {
      support.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: separator }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SUBMENU_OPEN_DELAY_MS + 50));
    });
    expect(submenu()).toBeNull();
    expect(support.getAttribute("aria-expanded")).not.toBe("true");
    expect(support.className).not.toContain("rowActive");
  });

  it("does not open a submenu the pointer brushed past onto a sibling row", async () => {
    await act(async () => trigger().click());
    const rows = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const support = rows[1]!;
    await act(async () => {
      support.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    await act(async () => {
      rows[2]!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SUBMENU_OPEN_DELAY_MS + 50));
    });
    expect(submenu()).toBeNull();
    expect(support.getAttribute("aria-expanded")).not.toBe("true");
    expect(support.className).not.toContain("rowActive");
  });

  it("skips motion entirely when quick", async () => {
    await act(async () => {
      root.render(createElement(PopoverMenu, { items, ariaLabel: "You", trigger: () => "You", quick: true }));
    });
    await act(async () => trigger().click());
    const surface = sheet()!.closest("[data-popover]") as HTMLElement;
    expect(surface.className).not.toContain("menuIn");
    expect(surface.className).not.toContain("menuOut");
    // No held close either: picking a row unmounts the sheet at once.
    const rows = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    await act(async () => rows[0]!.click());
    expect(sheet()).toBeNull();
  });

  it("opens the submenu with the inline end arrow and closes only it with Escape", async () => {
    await act(async () => trigger().click());
    const support = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]!;
    support.focus();
    await key(support, "ArrowRight");
    await flush();
    expect(submenu()).not.toBeNull();
    expect(submenu()!.className).toContain("menuIn");
    expect(support.getAttribute("aria-expanded")).toBe("true");
    const first = submenu()!.querySelector<HTMLElement>('[role="menuitem"]')!;
    await act(async () => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(submenu()).toBeNull();
    expect(sheet()).not.toBeNull();
    expect(document.activeElement).toBe(support);
  });

  it("keeps arrow navigation inside the submenu instead of jumping back to the menu", async () => {
    await act(async () => trigger().click());
    const support = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]!;
    support.focus();
    await key(support, "ArrowRight");
    await flush();
    const subRows = [...submenu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(document.activeElement).toBe(subRows[0]);
    // Keys pressed inside the submenu are handled there. They bubble through
    // the portal along the fiber tree, so the main list's handler must not
    // treat the missing row as a miss and re-claim focus for its own list.
    await key(subRows[0]!, "ArrowDown");
    expect(document.activeElement).toBe(subRows[1]);
    await key(subRows[1]!, "ArrowUp");
    expect(document.activeElement).toBe(subRows[0]);
    await key(subRows[0]!, "End");
    expect(document.activeElement).toBe(subRows[subRows.length - 1]);
    await key(subRows[subRows.length - 1]!, "ArrowDown");
    expect(document.activeElement).toBe(subRows[0]);
  });

  it("releases the parent row's active state when its submenu closes", async () => {
    await act(async () => trigger().click());
    const support = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]!;
    support.focus();
    await key(support, "ArrowRight");
    await flush();
    expect(support.getAttribute("aria-expanded")).toBe("true");
    expect(support.className).toContain("rowActive");
    const first = submenu()!.querySelector<HTMLElement>('[role="menuitem"]')!;
    await act(async () => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    // The highlight and aria-expanded are live state, not the held payload
    // that keeps the closing sheet rendered: Escape here, a sibling hover and
    // a whole-menu close elsewhere must all release them.
    expect(submenu()).toBeNull();
    expect(support.getAttribute("aria-expanded")).toBe("false");
    expect(support.className).not.toContain("rowActive");
  });

  it("releases the parent row's active state when the pointer moves to a sibling row", async () => {
    await act(async () => trigger().click());
    const rows = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const support = rows[1]!;
    await act(async () => {
      support.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, SUBMENU_OPEN_DELAY_MS + 50));
    });
    expect(submenu()).not.toBeNull();
    expect(support.className).toContain("rowActive");
    await act(async () => {
      rows[2]!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, OPEN_DELAY_MS + 60));
    });
    expect(submenu()).toBeNull();
    expect(support.getAttribute("aria-expanded")).toBe("false");
    expect(support.className).not.toContain("rowActive");
  });

  it("releases the parent row when the pointer leaves the submenu into empty space", async () => {
    await act(async () => trigger().click());
    const support = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]!;
    support.focus();
    await key(support, "ArrowRight");
    await flush();
    expect(submenu()).not.toBeNull();
    // React runs enter/leave through the portal along the fiber tree, so
    // leaving the sheet reaches the main menu's own leave timer; that timer
    // forgives a quick return, then closes the sheet. The row state must
    // release with it instead of latching onto the last opened submenu.
    await act(async () => {
      submenu()!.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, OPEN_DELAY_MS + 20));
    });
    expect(submenu()).not.toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, CLOSE_DELAY_MS));
    });
    expect(submenu()).toBeNull();
    expect(support.getAttribute("aria-expanded")).toBe("false");
    expect(support.className).not.toContain("rowActive");
  });

  it("scrolls a submenu taller than the window inside its own box", async () => {
    await act(async () => trigger().click());
    const support = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]!;
    support.focus();
    await key(support, "ArrowRight");
    await flush();
    // The inner layer (not the animated outer shell) carries the scroll
    // caps, so a tall submenu scrolls instead of running off-screen.
    const inner = submenu()!.firstElementChild as HTMLElement;
    expect(inner.style.overflowY).toBe("auto");
    expect(inner.style.maxHeight).not.toBe("");
  });

  it("keeps a closing submenu mounted and inert until it finishes closing", async () => {
    delete document.documentElement.dataset.reducedMotion;
    await act(async () => trigger().click());
    const support = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]!;
    support.focus();
    await key(support, "ArrowRight");
    await flush();
    expect(submenu()).not.toBeNull();
    const first = submenu()!.querySelector<HTMLElement>('[role="menuitem"]')!;
    await act(async () => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    // Still mounted while shrinking, out of reach; the main sheet stays open.
    expect(submenu()).not.toBeNull();
    expect(submenu()!.className).toContain("menuOut");
    expect(submenu()!.hasAttribute("inert")).toBe(true);
    expect(sheet()).not.toBeNull();
    expect(document.activeElement).toBe(support);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, MENU_CLOSE_MS)); });
    expect(submenu()).toBeNull();
    expect(sheet()).not.toBeNull();
    document.documentElement.dataset.reducedMotion = "true";
  });

  it("keeps a submenu shrinking alongside the main sheet when the whole menu closes", async () => {
    delete document.documentElement.dataset.reducedMotion;
    await act(async () => trigger().click());
    const support = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')][1]!;
    support.focus();
    await key(support, "ArrowRight");
    await flush();
    expect(submenu()).not.toBeNull();
    // Escape from outside the submenu closes everything: the submenu must
    // play its own shrink in parallel, not vanish the moment the main does.
    await key(sheet()!, "Escape");
    expect(submenu()).not.toBeNull();
    expect(submenu()!.className).toContain("menuOut");
    expect(submenu()!.hasAttribute("inert")).toBe(true);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, MENU_CLOSE_MS)); });
    expect(submenu()).toBeNull();
    expect(sheet()).toBeNull();
    document.documentElement.dataset.reducedMotion = "true";
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

  it("keeps a select-exit mounted and inert until it finishes closing", async () => {
    delete document.documentElement.dataset.reducedMotion;
    await act(async () => trigger().click());
    const rows = [...sheet()!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    await act(async () => rows[0]!.click());
    // Still mounted while closing, out of reach, then unmounted.
    const surface = sheet()!.closest("[data-popover]") as HTMLElement;
    expect(surface.className).toContain("menuOut");
    expect(surface.hasAttribute("inert")).toBe(true);
    expect(picked).toEqual(["Usage"]);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, MENU_CLOSE_MS)); });
    expect(sheet()).toBeNull();
    document.documentElement.dataset.reducedMotion = "true";
  });

  it("closes on a press outside, but not on a press inside the portalled sheet", async () => {
    await act(async () => trigger().click());
    await act(async () => sheet()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(sheet()).not.toBeNull();
    await act(async () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(sheet()).toBeNull();
  });
});
