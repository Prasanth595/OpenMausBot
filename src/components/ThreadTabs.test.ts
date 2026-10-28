// @vitest-environment happy-dom
// The header's quick thread switcher: the same list the bot panel's Conversations card draws, as tabs.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Task } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn() }));

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: original.initialState, dispatch: fixture.dispatch }) };
});

const { ThreadTabs } = await import("./ThreadTabs");

const now = Date.now();
const task = (threadId: string, title: string, order: number, extra: Partial<Task> = {}): Task =>
  ({ threadId, title, createdAt: now - 86_400_000, updatedAt: now - order * 60_000, lastThreadOrderAt: now - order * 60_000, ...extra });
const tasks: Task[] = [
  task("launch", "Translate the launch post", 1, { unread: true }),
  task("who", "Who am I?", 2),
  task("pricing", "Competitor pricing", 3, { busy: true, activity: "working", turnStartedAt: now - 72_000 }),
  task("deck", "Summarise the board deck", 4),
  task("hiring", "Draft the hiring post", 5, { pinned: true }),
  task("run", "Morning brief run", 0, { routineRunId: "run-1" }),
  task("old", "Old chat", 6, { archivedAt: now - 1_000 }),
];
const bot = (extra: Partial<Bot> = {}): Bot => ({
  id: "research", threadId: "who", name: "Research", title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "fake", model: "fake" }, tasks, messages: [], ...extra,
});

let host: HTMLDivElement;
let root: Root;
const render = (of: Bot) => flushSync(() => root.render(createElement(ThreadTabs, { bot: of, dispatch: fixture.dispatch })));
const click = (element: Element | null | undefined) => {
  if (!element) throw new Error("nothing to click");
  flushSync(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
};
const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const tab = (threadId: string) => host.querySelector<HTMLButtonElement>(`[data-thread-tab="${threadId}"]`)!;
const menu = (threadId: string) => {
  click(host.querySelector(`[data-thread-tab-item="${threadId}"] button[aria-haspopup="menu"]`));
  return document.querySelector<HTMLElement>('[data-sidebar-popover-menu="anchored"]')!;
};
const menuItem = (sheet: HTMLElement, label: string) =>
  [...sheet.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === label)!;
const key = (element: Element, name: string) => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  flushSync(() => element.dispatchEvent(event));
  return event;
};

beforeEach(() => {
  fixture.dispatch.mockReset();
  document.documentElement.dataset.reducedMotion = "true";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("a bot's threads in the chat header", () => {
  it("lists every listed thread as a tab, marking the open one and leaving routine runs and archived threads out", () => {
    render(bot());
    expect(tabs().map((element) => element.dataset.threadTab)).toEqual(["hiring", "launch", "who", "pricing", "deck"]);
    expect(tab("who").getAttribute("aria-selected")).toBe("true");
    expect(tab("who").id).toBe("thread-tab-who");
    expect(tab("who").getAttribute("aria-controls")).toBe("chat-thread-panel");
    expect(tab("who").tabIndex).toBe(0);
    expect(tab("who").className).toContain("focus-visible:ring-inset");
    expect(tab("launch").getAttribute("aria-selected")).toBe("false");
    expect(tab("launch").tabIndex).toBe(-1);
    expect(host.querySelector('[role="tablist"]')!.getAttribute("aria-label")).toBe("Conversations");
  });

  it("hides the strip when the open thread is archived or a routine run, so no tab is selected by a missing id", () => {
    render(bot({ threadId: "old" }));
    expect(host.querySelector("[data-chathead-tabs]")).toBeNull();
    expect(tabs()).toHaveLength(0);
    render(bot({ threadId: "run" }));
    expect(host.querySelector("[data-chathead-tabs]")).toBeNull();
    expect(tabs()).toHaveLength(0);
  });

  it("draws nothing for a bot with one conversation", () => {
    render(bot({ tasks: [task("who", "Who am I?", 1)] }));
    expect(host.querySelector("[data-chathead-tabs]")).toBeNull();
    expect(tabs()).toHaveLength(0);
  });

  it("shows a running turn and an unread reply from the tab itself", () => {
    render(bot());
    expect(tab("pricing").querySelector("svg.animate-spin")).not.toBeNull();
    expect(tab("pricing").textContent).toContain("Working");
    expect(tab("launch").querySelector("span.bg-accent")).not.toBeNull();
    expect(tab("launch").textContent).toContain("Unread");
    expect(tab("who").textContent).not.toContain("Unread");
    render(bot({ tasks: [task("who", "Who am I?", 1), task("triage", "Triage the inbox", 2, { activity: "waiting-on-you" })] }));
    expect(tab("triage").textContent).toContain("Waiting");
  });

  it("shows a turn waiting on the person instead of the spinner its busy flag would raise", () => {
    const waiting = task("triage", "Triage the inbox", 2, {
      activity: "waiting-on-you", busy: true, turnStartedAt: now - 30_000,
    });
    render(bot({ tasks: [task("who", "Who am I?", 1), waiting] }));
    const strip = tab("triage");
    expect(strip.textContent).toContain("Waiting");
    expect(strip.textContent).not.toContain("Working");
    expect(strip.querySelector("svg.animate-spin")).toBeNull();
    // The marker is visible, not only announced, and the state keeps its words for a reader.
    expect(strip.querySelector("svg.text-accent")).not.toBeNull();
    expect(strip.querySelector(".sr-only")!.textContent).toBe("Waiting");
    expect(strip.getAttribute("title")).toBe("Triage the inbox · Waiting");
  });

  it("switches to the tab that is clicked, and leaves the open one alone", () => {
    render(bot());
    click(tab("pricing"));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "switchTask", botId: "research", threadId: "pricing" }]]);
    fixture.dispatch.mockReset();
    click(tab("who"));
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("moves focus with the arrow keys, Home and End without switching", () => {
    render(bot());
    // Only one tab is tabbable at a time: the open one until something else takes focus.
    expect(tab("who").tabIndex).toBe(0);
    expect(tab("pricing").tabIndex).toBe(-1);

    const pressed = key(tab("who"), "ArrowRight");
    expect(pressed.defaultPrevented).toBe(true);
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(tab("pricing"));
    expect(tab("pricing").tabIndex).toBe(0);
    expect(tab("who").tabIndex).toBe(-1);
    // Focus moved; the open thread did not.
    expect(tab("who").getAttribute("aria-selected")).toBe("true");
    expect(tab("pricing").getAttribute("aria-selected")).toBe("false");

    // A second press starts from the tab that has focus, not from the stale open thread.
    key(tab("pricing"), "ArrowRight");
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(tab("deck"));

    key(tab("deck"), "Home");
    expect(document.activeElement).toBe(tab("hiring"));
    key(tab("hiring"), "End");
    expect(document.activeElement).toBe(tab("deck"));
    key(tab("deck"), "ArrowLeft");
    expect(document.activeElement).toBe(tab("pricing"));
  });

  it("clears a pending keyboard refocus when a mouse switch follows", async () => {
    render(bot());
    const pricingTab = tab("pricing");
    pricingTab.focus();
    // Enter/Space on a button is a click with detail 0.
    flushSync(() => pricingTab.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
    const deckTab = tab("deck");
    deckTab.focus();
    flushSync(() => deckTab.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));

    // The keyboard switch lands first and would refocus pricing on its second frame; the mouse switch must have cleared it.
    render(bot({ threadId: "pricing" }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    render(bot({ threadId: "deck" }));
    expect(tab("deck").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("deck"));
  });

  it("switches when the focused tab is pressed, not merely focused", () => {
    render(bot());
    key(tab("who"), "ArrowRight");
    // A native button turns Enter and Space into a click; the keydown itself must not switch.
    key(tab("pricing"), "Enter");
    expect(fixture.dispatch).not.toHaveBeenCalled();
    click(tab("pricing"));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "switchTask", botId: "research", threadId: "pricing" }]]);
  });

  it("wraps round at both ends", () => {
    render(bot({ threadId: "deck" }));
    key(tab("deck"), "ArrowRight");
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(tab("hiring"));
  });

  it("leaves the arrow keys alone when they are pressed in a tab's menu button", () => {
    render(bot());
    key(host.querySelector('[data-thread-tab-item="who"] button[aria-haspopup="menu"]')!, "ArrowRight");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("opens with a right click as the row menu does", () => {
    render(bot());
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    flushSync(() => host.querySelector('[data-thread-tab-item="launch"]')!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-sidebar-popover-menu="anchored"]')).not.toBeNull();
  });

  it("offers every thread action and New conversation from a tab's menu", () => {
    render(bot({ projects: [{ id: "p1", name: "Launch" }] }));
    const sheet = menu("launch");
    const labels = [...sheet.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(labels).toEqual(expect.arrayContaining([
      "New conversation", "Rename thread", "Move to folder", "Pin", "Copy link", "Archive", "Snooze", "Delete thread",
    ]));
    expect(labels).not.toContain("Regenerate title");
  });

  it("pins, archives and snoozes through the sidebar's own actions", () => {
    render(bot());
    click(menuItem(menu("launch"), "Pin"));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "updateTask", botId: "research", threadId: "launch", patch: { pinned: true } }]]);
    fixture.dispatch.mockReset();
    click(menuItem(menu("deck"), "Archive"));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "updateTask", botId: "research", threadId: "deck", patch: { archivedAt: expect.any(Number) } }]]);
    fixture.dispatch.mockReset();
    click(menuItem(menu("deck"), "Snooze"));
    const submenu = document.querySelector<HTMLElement>("[data-sidebar-popover-submenu]")!;
    click(menuItem(submenu, "Until new activity"));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "updateTask", botId: "research", threadId: "deck", patch: { snoozedUntil: 0 } }]]);
  });

  it("renames the tab in place, through renameTask", () => {
    render(bot());
    click(menuItem(menu("launch"), "Rename thread"));
    const input = host.querySelector<HTMLInputElement>('[data-thread-tab-item="launch"] input')!;
    expect(input.value).toBe("Translate the launch post");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Launch post, translated");
    flushSync(() => input.dispatchEvent(new Event("input", { bubbles: true })));
    key(input, "Enter");
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "renameTask", botId: "research", threadId: "launch", title: "Launch post, translated" }]]);
    expect(host.querySelector('[data-thread-tab-item="launch"] input')).toBeNull();
  });

  it("deletes behind the same confirmation the sidebar shows", () => {
    render(bot());
    click(menuItem(menu("deck"), "Delete thread"));
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Delete thread?");
    click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Delete thread"));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "deleteTask", botId: "research", threadId: "deck" }]]);
  });

  it("starts a new conversation in the open thread's folder", () => {
    render(bot({ projects: [{ id: "p1", name: "Launch" }], tasks: tasks.map((entry) => entry.threadId === "who" ? { ...entry, projectId: "p1" } : entry) }));
    click(menuItem(menu("who"), "New conversation"));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "newTask", botId: "research", projectId: "p1" }]]);
  });

  it("keeps a long strip scrolling rather than growing the header, and scrolls the whole active row into view", () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.getAttribute("data-thread-tab-item") ?? "");
    };
    try {
      render(bot());
      expect(scrolled).toEqual(["who"]);
      render(bot({ threadId: "deck" }));
      expect(scrolled).toEqual(["who", "deck"]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
    const list = host.querySelector<HTMLElement>('[role="tablist"]')!;
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).toContain("py-1");
    expect(list.className).toContain("-my-1");
    expect(list.className).toContain("[scrollbar-width:none]");
    // The row is the scroll target because it also holds the 24px action trigger; scrolling the button would leave
    // the trigger outside the visible scrollport.
    expect(list.style.scrollPaddingInlineEnd).toBe("1.75rem");
    const row = host.querySelector('[data-thread-tab-item="who"]')!;
    expect(row.querySelector('[role="tab"]')).not.toBeNull();
    expect(row.querySelector('button[aria-haspopup="menu"]')).not.toBeNull();
  });

  it("offers edge buttons only while tabs continue off-screen, and they scroll instead of switching", () => {
    document.documentElement.dataset.reducedMotion = "false";
    render(bot());
    expect(host.querySelector("[data-thread-tabs-back]")).toBeNull();
    expect(host.querySelector("[data-thread-tabs-forward]")).toBeNull();

    const list = host.querySelector<HTMLElement>('[role="tablist"]')!;
    Object.defineProperty(list, "scrollWidth", { configurable: true, value: 640 });
    Object.defineProperty(list, "clientWidth", { configurable: true, value: 300 });
    const scrollBy = vi.fn();
    Object.defineProperty(list, "scrollBy", { configurable: true, value: scrollBy });
    flushSync(() => list.dispatchEvent(new Event("scroll")));

    const back = host.querySelector<HTMLButtonElement>("[data-thread-tabs-back]")!;
    const forward = host.querySelector<HTMLButtonElement>("[data-thread-tabs-forward]")!;
    expect(back).not.toBeNull();
    expect(back.className).toContain("focus-visible:ring-inset");
    expect(forward.className).toContain("focus-visible:ring-inset");
    expect(forward).not.toBeNull();
    expect(back.getAttribute("aria-label")).toBe("Earlier threads");
    expect(forward.getAttribute("aria-label")).toBe("Later threads");
    // Nothing is hidden behind the start edge on first paint, but there is more to the right.
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(false);

    click(forward);
    expect(scrollBy).toHaveBeenCalledWith({ left: 225, behavior: "smooth" });
    expect(fixture.dispatch).not.toHaveBeenCalled();

    list.scrollLeft = 340;
    flushSync(() => list.dispatchEvent(new Event("scroll")));
    expect(host.querySelector<HTMLButtonElement>("[data-thread-tabs-forward]")!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>("[data-thread-tabs-back]")!.disabled).toBe(false);
  });

  it("does not animate that scroll when the person has asked for less motion", () => {
    render(bot());
    const list = host.querySelector<HTMLElement>('[role="tablist"]')!;
    Object.defineProperty(list, "scrollWidth", { configurable: true, value: 640 });
    Object.defineProperty(list, "clientWidth", { configurable: true, value: 300 });
    const scrollBy = vi.fn();
    Object.defineProperty(list, "scrollBy", { configurable: true, value: scrollBy });
    flushSync(() => list.dispatchEvent(new Event("scroll")));

    click(host.querySelector("[data-thread-tabs-forward]"));
    expect(scrollBy).toHaveBeenCalledWith({ left: 225, behavior: "auto" });
  });

  it("sets up its scroll handling when a second thread gives the strip something to scroll", () => {
    render(bot({ tasks: [task("who", "Who am I?", 1)] }));
    expect(host.querySelector('[role="tablist"]')).toBeNull();

    render(bot());
    const list = host.querySelector<HTMLElement>('[role="tablist"]')!;
    Object.defineProperty(list, "scrollWidth", { configurable: true, value: 640 });
    Object.defineProperty(list, "clientWidth", { configurable: true, value: 300 });
    list.scrollLeft = 340;
    flushSync(() => list.dispatchEvent(new Event("scroll")));

    expect(host.querySelector<HTMLButtonElement>("[data-thread-tabs-back]")!.disabled).toBe(false);
    expect(host.querySelector<HTMLButtonElement>("[data-thread-tabs-forward]")!.disabled).toBe(true);
  });

  it("gives the tab stop back to the open thread when focus leaves the strip", () => {
    render(bot());
    key(tab("who"), "ArrowRight");
    expect(tab("pricing").tabIndex).toBe(0);
    flushSync(() => tab("pricing").blur());
    expect(tab("who").tabIndex).toBe(0);
    expect(tab("pricing").tabIndex).toBe(-1);
  });

  it("reads RTL scroll offsets from the right edge, so the ends still disable", () => {
    const original = window.getComputedStyle;
    const style = vi.spyOn(window, "getComputedStyle").mockImplementation(((element: Element, pseudo?: string | null) =>
      element === host.querySelector('[role="tablist"]')
        ? ({ direction: "rtl" } as unknown as CSSStyleDeclaration)
        : original(element, pseudo)) as typeof window.getComputedStyle);
    try {
      render(bot());
      const list = host.querySelector<HTMLElement>('[role="tablist"]')!;
      Object.defineProperty(list, "scrollWidth", { configurable: true, value: 640 });
      Object.defineProperty(list, "clientWidth", { configurable: true, value: 300 });
      Object.defineProperty(list, "scrollBy", { configurable: true, value: vi.fn() });
      flushSync(() => list.dispatchEvent(new Event("scroll")));

      // RTL starts at scrollLeft 0 and scrolls negative towards the later tabs.
      expect(host.querySelector<HTMLButtonElement>("[data-thread-tabs-back]")!.disabled).toBe(true);
      expect(host.querySelector<HTMLButtonElement>("[data-thread-tabs-forward]")!.disabled).toBe(false);

      list.scrollLeft = -340;
      flushSync(() => list.dispatchEvent(new Event("scroll")));
      expect(host.querySelector<HTMLButtonElement>("[data-thread-tabs-forward]")!.disabled).toBe(true);
      expect(host.querySelector<HTMLButtonElement>("[data-thread-tabs-back]")!.disabled).toBe(false);
      // The first control sits at the right edge in RTL, so it points that way.
      expect(host.querySelector("[data-thread-tabs-back] svg")!.getAttribute("class")).toContain("chevron-right");
    } finally {
      style.mockRestore();
    }
  });
});
