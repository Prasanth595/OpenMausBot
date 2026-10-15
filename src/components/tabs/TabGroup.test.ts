// @vitest-environment happy-dom
// The tab bar is headless: it ships behaviour and state, never styles. These
// tests pin the behaviour (selection, keyboard, the narrow decision, panel
// wiring) and the state contract (`data-*` + the render prop), not any look.
import { Fragment, createElement, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tab } from "./Tab";
import { TabGroup } from "./TabGroup";
import { TabList } from "./TabList";
import { TabPanel } from "./TabPanel";
import { TabPanels } from "./TabPanels";
import type { TabState } from "./types";

let root: Root | null = null;

/** Mounts a node into a fresh container with a sync React root for assertions. */
function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  flushSync(() => root!.render(node));
}

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** Returns every rendered tab trigger in DOM order. */
function tabs() {
  return [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
}

/** Returns the tablist element. */
function list() {
  return document.querySelector<HTMLElement>('[role="tablist"]')!;
}

/** Dispatches a keyboard event after flushing the prior controlled rerender. */
function press(el: Element, key: string) {
  // flushSync: apply the previous press's controlled rerender before the next
  // key, the way real keystrokes land on separate frames.
  flushSync(() => {
    el.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** Stubs ResizeObserver so a test can drive the list's narrow measurement. */
function stubResize() {
  const observers: (() => void)[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  return observers;
}

/** Gives the list's measuring viewport `room` px and re-runs its observers. */
function resize(room: number, observers: (() => void)[]) {
  const viewport = list().parentElement!;
  Object.defineProperty(viewport, "clientWidth", { configurable: true, value: room });
  flushSync(() => observers.forEach((callback) => callback()));
}

/** Controlled bar starting on "a", with "c" disabled, and no panels. */
function ControlledBar({ onChange, onInput }: { onChange?: (value: string) => void; onInput?: (value: string) => void }) {
  const [value, setValue] = useState("a");
  return createElement(
    TabGroup,
    {
      value,
      onChange: (next: string) => {
        setValue(next);
        onChange?.(next);
      },
      onInput,
    },
    createElement(
      TabList,
      { "aria-label": "Demo", "data-testid": "demo-tabs" },
      createElement(Tab, { value: "a" }, "Alpha"),
      createElement(Tab, { value: "b" }, "Beta"),
      createElement(Tab, { value: "c", disabled: true }, "Gamma"),
    ),
  );
}

/** Returns the tab trigger whose `data-value` is `value`. */
function tab(value: string) {
  return document.querySelector<HTMLElement>(`[role="tab"][data-value="${value}"]`)!;
}

/** Returns the tabpanel wired to `value`, through its id from the group. */
function panelFor(value: string) {
  const id = tab(value).getAttribute("aria-controls")!;
  return document.getElementById(id)!;
}

describe("TabGroup", () => {
  it("composes a standalone bar and marks the selection without styling it", () => {
    mount(createElement(ControlledBar));
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs()[1].getAttribute("aria-selected")).toBe("false");
    expect(tabs()[0].tabIndex).toBe(0);
    expect(tabs()[1].tabIndex).toBe(-1);
    expect(tabs()[2].getAttribute("aria-disabled")).toBe("true");
    // The bar is the tablist, the caller's attributes land on it, and nothing
    // in the package brings classes of its own.
    expect(list().getAttribute("data-testid")).toBe("demo-tabs");
    expect(list().getAttribute("aria-label")).toBe("Demo");
    expect(list().className).toBe("");
    expect(tabs()[0].className).toBe("");
    // Standalone: no panels were asked for, so none exist.
    expect(document.querySelector('[role="tabpanel"]')).toBeNull();
  });

  it("notifies the caller through onChange (controlled via props)", () => {
    const onChange = vi.fn();
    mount(createElement(ControlledBar, { onChange }));
    flushSync(() => tabs()[1].click());
    expect(onChange).toHaveBeenCalledWith("b");
    // Controlled state follows the prop on rerender.
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
  });

  it("ignores clicks on disabled tabs", () => {
    const onChange = vi.fn();
    mount(createElement(ControlledBar, { onChange }));
    flushSync(() => tabs()[2].click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("fires onInput on every press, onChange only when selection moves", () => {
    const events: [string, string][] = [];
    mount(createElement(ControlledBar, {
      onInput: (next: string) => events.push(["input", next]),
      onChange: (next: string) => events.push(["change", next]),
    }));
    // Activating an inactive tab fires input, then change.
    flushSync(() => tabs()[1].click());
    expect(events).toEqual([["input", "b"], ["change", "b"]]);
    // Re-pressing the active tab fires input only.
    flushSync(() => tabs()[1].click());
    expect(events).toEqual([["input", "b"], ["change", "b"], ["input", "b"]]);
    // Disabled tabs fire neither.
    flushSync(() => tabs()[2].click());
    expect(events).toEqual([["input", "b"], ["change", "b"], ["input", "b"]]);
  });

  it("moves with arrow keys and skips disabled tabs", () => {
    const onChange = vi.fn();
    mount(createElement(ControlledBar, { onChange }));
    tabs()[0].focus();
    press(document.activeElement!, "ArrowRight");
    expect(onChange).toHaveBeenCalledWith("b");
    // From b, ArrowRight wraps past disabled c back to a.
    press(tabs()[1], "ArrowRight");
    expect(onChange).toHaveBeenLastCalledWith("a");
    press(tabs()[0], "End");
    expect(onChange).toHaveBeenLastCalledWith("b");
    press(tabs()[1], "Home");
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("renders the caller's own element through as={Fragment} with its state", () => {
    /** Controlled bar whose tabs are the caller's own buttons. */
    function Custom() {
      const [value, setValue] = useState("a");
      return createElement(
        TabGroup,
        { value, onChange: setValue },
        createElement(
          TabList,
          null,
          createElement(
            Tab,
            {
              value: "a",
              as: Fragment,
              className: "from-tab",
              children: ({ selected, hover, focus, disabled, narrow, display }: TabState) =>
                createElement(
                  "button",
                  { className: "mine", "data-probe": `${selected}/${hover}/${focus}/${disabled}/${narrow}/${display}` },
                  "A",
                ),
            },
          ),
          createElement(Tab, { value: "b", as: Fragment, children: () => createElement("button", null, "B") }),
        ),
      );
    }
    mount(createElement(Custom));
    const [first] = tabs();
    // The caller's element stays theirs — classes, tag, attributes — while the
    // tab's own roles, wiring and state are merged onto it.
    expect(first.tagName).toBe("BUTTON");
    expect(first.className).toBe("mine from-tab");
    expect(first.getAttribute("role")).toBe("tab");
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(first.getAttribute("data-value")).toBe("a");
    expect(first.getAttribute("data-probe")).toBe("true/false/false/false/false/icon-text");
    flushSync(() => tabs()[1].click());
    expect(tabs()[0].getAttribute("data-probe")).toBe("false/false/false/false/false/icon-text");
  });

  it("tracks hover and focus for the render prop", async () => {
    /** Bar with one tab reporting its pointer and focus state. */
    function Probe() {
      const [value, setValue] = useState("a");
      return createElement(
        TabGroup,
        { value, onChange: setValue },
        createElement(
          TabList,
          null,
          createElement(Tab, {
            value: "a",
            "data-testid": "probe",
            children: ({ hover, focus }: TabState) => createElement("span", null, `${hover}/${focus}`),
          }),
        ),
      );
    }
    mount(createElement(Probe));
    const tab = document.querySelector<HTMLElement>('[data-testid="probe"]')!;
    expect(tab.textContent).toBe("false/false");
    // Pointer events are continuous priority in React, so the hover state
    // lands a tick later (waitFor), not inside the dispatch.
    tab.dispatchEvent(new window.Event("pointerover", { bubbles: true }));
    await vi.waitFor(() => expect(tab.getAttribute("data-hover")).toBe("true"));
    expect(tab.textContent).toBe("true/false");
    tab.dispatchEvent(new window.Event("pointerout", { bubbles: true }));
    await vi.waitFor(() => expect(tab.getAttribute("data-hover")).toBeNull());
    flushSync(() => tab.focus());
    expect(tab.getAttribute("data-focus")).toBe("true");
    expect(tab.textContent).toBe("false/true");
    flushSync(() => tab.blur());
    expect(tab.getAttribute("data-focus")).toBeNull();
  });

  it("renders another element for a part with as", () => {
    mount(createElement(
      TabGroup,
      { value: "a", onChange: () => {} },
      createElement(TabList, { as: "section", "aria-label": "Wrapped" }, createElement(Tab, { value: "a" }, "A")),
    ));
    expect(list().tagName).toBe("SECTION");
  });

  it("wires panels to their tabs and unmounts the ones not selected", () => {
    /** Controlled group with one panel per tab. */
    function Panelled() {
      const [value, setValue] = useState("a");
      return createElement(
        TabGroup,
        { value, onChange: setValue, id: "grp" },
        createElement(TabList, null, createElement(Tab, { value: "a" }, "A"), createElement(Tab, { value: "b" }, "B")),
        createElement(
          TabPanels,
          null,
          createElement(TabPanel, { value: "a" }, "Panel A"),
          createElement(TabPanel, { value: "b" }, "Panel B"),
        ),
      );
    }
    mount(createElement(Panelled));
    expect(tabs()[0].getAttribute("aria-controls")).toBe("grp-panel-a");
    const panel = document.querySelector<HTMLElement>('[role="tabpanel"]')!;
    expect(panel.id).toBe("grp-panel-a");
    expect(panel.getAttribute("aria-labelledby")).toBe("grp-tab-a");
    expect(panel.getAttribute("data-selected")).toBe("true");
    expect(panel.textContent).toBe("Panel A");
    expect(panel.className).toBe("");
    // The unselected panel is gone, not hidden.
    expect(document.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
    flushSync(() => tabs()[1].click());
    expect(document.querySelector<HTMLElement>('[role="tabpanel"]')!.textContent).toBe("Panel B");
  });

  it("keeps a panel mounted with unmount={false}", () => {
    mount(createElement(
      TabGroup,
      { value: "a", onChange: () => {} },
      createElement(TabList, null, createElement(Tab, { value: "a" }, "A"), createElement(Tab, { value: "b" }, "B")),
      createElement(
        TabPanels,
        null,
        createElement(TabPanel, { value: "a" }, "Panel A"),
        createElement(TabPanel, { value: "b", unmount: false }, "Panel B"),
      ),
    ));
    const panels = [...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    expect(panels.map((panel) => panel.hidden)).toEqual([false, true]);
    expect(panels[1].getAttribute("data-selected")).toBeNull();
  });

  it("decides it is narrow itself and collapses to the caller's compact form", () => {
    const observers = stubResize();
    mount(createElement(
      TabGroup,
      { value: "a", onChange: () => {} },
      createElement(
        TabList,
        { minTabWidth: 120 },
        createElement(Tab, { value: "a" }, "Alpha"),
        createElement(Tab, { value: "b" }, "Bravo"),
      ),
    ));
    // Before measuring, the full form shows; nothing was asked of the caller.
    expect(tabs()[0].getAttribute("data-display")).toBe("icon-text");
    expect(list().getAttribute("data-narrow")).toBeNull();
    // 100px of room < 2 tabs × 120px: the list says so and drops to text-only.
    resize(100, observers);
    expect(list().getAttribute("data-narrow")).toBe("true");
    expect(tabs().map((tab) => tab.getAttribute("data-display"))).toEqual(["text-only", "text-only"]);
    // Room comes back: the full form returns.
    resize(400, observers);
    expect(list().getAttribute("data-narrow")).toBeNull();
    expect(tabs()[0].getAttribute("data-display")).toBe("icon-text");
  });

  it("collapses to icon-only when the caller prefers icons", () => {
    const observers = stubResize();
    mount(createElement(
      TabGroup,
      { value: "a", onChange: () => {} },
      createElement(
        TabList,
        { minTabWidth: 120, collapse: "icon" },
        createElement(Tab, { value: "a" }, "Alpha"),
      ),
    ));
    resize(50, observers);
    expect(tabs()[0].getAttribute("data-display")).toBe("icon-only");
  });

  it("never collapses with collapse=none, and lets a tab override its own form", () => {
    const observers = stubResize();
    mount(createElement(
      TabGroup,
      { value: "a", onChange: () => {} },
      createElement(
        TabList,
        { minTabWidth: 120, collapse: "none" },
        createElement(Tab, { value: "a" }, "Alpha"),
        createElement(Tab, { value: "b", "data-display": "icon-only" }, "Bravo"),
      ),
    ));
    resize(10, observers);
    expect(list().getAttribute("data-narrow")).toBeNull();
    expect(tabs().map((tab) => tab.getAttribute("data-display"))).toEqual(["icon-text", "icon-only"]);
  });

  it("publishes the scrollbar mode it was given", () => {
    mount(createElement(
      TabGroup,
      { value: "a", onChange: () => {} },
      createElement(TabList, { scrollbar: "hidden" }, createElement(Tab, { value: "a" }, "Alpha")),
    ));
    expect(list().getAttribute("data-scrollbar")).toBe("hidden");
    expect(list().getAttribute("data-scrolling")).toBeNull();
  });

  it("publishes a transient scrolling state, then puts it away", async () => {
    mount(createElement(
      TabGroup,
      { value: "a", onChange: () => {} },
      createElement(TabList, { scrollbar: "scrolling" }, createElement(Tab, { value: "a" }, "Alpha")),
    ));
    expect(list().getAttribute("data-scrollbar")).toBe("scrolling");
    expect(list().getAttribute("data-scrolling")).toBeNull();
    // Scroll is a React "continuous" event, so the reveal lands a tick later
    // (waitFor), not inside the dispatch.
    flushSync(() => {
      list().dispatchEvent(new window.Event("scroll"));
    });
    await vi.waitFor(() => expect(list().getAttribute("data-scrolling")).toBe("true"));
    // Idle again: nothing is published until the next scroll.
    await vi.waitFor(() => expect(list().getAttribute("data-scrolling")).toBeNull(), { timeout: 2_000 });
  });

  it("keeps the caller's classes and attributes where they belong", () => {
    mount(createElement(
      TabGroup,
      { value: "a", onChange: () => {} },
      createElement(
        TabList,
        { className: "my-list", viewportClassName: "my-viewport", title: "Bar" },
        createElement(Tab, { value: "a", className: "my-tab", title: "Alpha" }, "Alpha"),
      ),
    ));
    expect(list().className).toBe("my-list");
    expect(list().getAttribute("title")).toBe("Bar");
    expect(list().parentElement!.className).toBe("my-viewport");
    expect(tabs()[0].className).toBe("my-tab");
    expect(tabs()[0].getAttribute("title")).toBe("Alpha");
  });

  it("runs the caller's own handlers alongside the part's", () => {
    const onClick = vi.fn();
    const onChange = vi.fn();
    mount(createElement(
      TabGroup,
      { value: "a", onChange },
      createElement(TabList, { onClick }, createElement(Tab, { value: "a" }, "Alpha")),
    ));
    flushSync(() => list().click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("TabGroup id prop", () => {
  /** Group whose id starts at `initial` and flips through the test's setter. */
  function ToggledId({ initial, onReady }: { initial?: string; onReady: (set: (next: string | undefined) => void) => void }) {
    const [id, setId] = useState<string | undefined>(initial);
    onReady(setId);
    return createElement(
      TabGroup,
      { value: "a", onChange: () => {}, id },
      createElement(TabList, null, createElement(Tab, { value: "a" }, "Alpha")),
      createElement(TabPanels, null, createElement(TabPanel, { value: "a" }, "Panel A")),
    );
  }

  it("keeps its hook order when the id arrives after a render without one", () => {
    let setId!: (next: string | undefined) => void;
    mount(createElement(ToggledId, { onReady: (set) => { setId = set; } }));
    expect(tab("a").getAttribute("aria-controls")).toBe(panelFor("a").id);
    expect(panelFor("a").id).not.toBe("labelled-panel-a");
    // Handing the group an id later must not change how many hooks it calls.
    flushSync(() => setId("labelled"));
    expect(tab("a").getAttribute("aria-controls")).toBe("labelled-panel-a");
    expect(panelFor("a").id).toBe("labelled-panel-a");
    expect(panelFor("a").getAttribute("aria-labelledby")).toBe("labelled-tab-a");
  });

  it("keeps its hook order when the id goes away again", () => {
    let setId!: (next: string | undefined) => void;
    mount(createElement(ToggledId, { initial: "labelled", onReady: (set) => { setId = set; } }));
    expect(tab("a").getAttribute("aria-controls")).toBe("labelled-panel-a");
    // Dropping it must not change the hook count either; the generated ids
    // take back over from the caller's.
    flushSync(() => setId(undefined));
    expect(tab("a").getAttribute("aria-controls")).not.toBe("labelled-panel-a");
    expect(tab("a").getAttribute("aria-controls")).toBe(panelFor("a").id);
    expect(panelFor("a").id).not.toBe("labelled-panel-a");
    expect(panelFor("a").getAttribute("aria-labelledby")).toBe(tab("a").id);
  });
});
