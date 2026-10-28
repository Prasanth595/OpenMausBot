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
    expect(tab("who").tabIndex).toBe(0);
    expect(tab("launch").getAttribute("aria-selected")).toBe("false");
    expect(tab("launch").tabIndex).toBe(-1);
    expect(host.querySelector('[role="tablist"]')!.getAttribute("aria-label")).toBe("Conversations");
  });

  it("keeps the archived thread that is open in the strip, so the tab for what is on screen is there", () => {
    render(bot({ threadId: "old" }));
    expect(tabs().map((element) => element.dataset.threadTab)).toContain("old");
    expect(tab("old").getAttribute("aria-selected")).toBe("true");
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

  it("switches to the tab that is clicked, and leaves the open one alone", () => {
    render(bot());
    click(tab("pricing"));
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "switchTask", botId: "research", threadId: "pricing" }]]);
    fixture.dispatch.mockReset();
    click(tab("who"));
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("moves with the arrow keys, Home and End", () => {
    render(bot());
    key(tab("who"), "ArrowRight");
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "switchTask", botId: "research", threadId: "pricing" }]]);
    fixture.dispatch.mockReset();
    key(tab("who"), "ArrowLeft");
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "switchTask", botId: "research", threadId: "launch" }]]);
    fixture.dispatch.mockReset();
    key(tab("who"), "Home");
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "switchTask", botId: "research", threadId: "hiring" }]]);
    fixture.dispatch.mockReset();
    key(tab("who"), "End");
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "switchTask", botId: "research", threadId: "deck" }]]);
  });

  it("wraps round at both ends", () => {
    render(bot({ threadId: "deck" }));
    key(tab("deck"), "ArrowRight");
    expect(fixture.dispatch.mock.calls).toEqual([[{ type: "switchTask", botId: "research", threadId: "hiring" }]]);
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

  it("keeps a long strip scrolling rather than growing the header, and scrolls the open tab into view", () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.getAttribute("data-thread-tab") ?? "");
    };
    try {
      render(bot());
      expect(scrolled).toEqual(["who"]);
      render(bot({ threadId: "deck" }));
      expect(scrolled).toEqual(["who", "deck"]);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
    const list = host.querySelector('[role="tablist"]')!;
    expect(list.className).toContain("overflow-x-auto");
  });
});
