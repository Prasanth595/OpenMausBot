// The sidebar header's menus — New or share (+) and Active Threads. The +
// menu is the shared PopoverMenu now, so what is proven here is the wiring:
// which rows the sidebar builds, and what each one opens. Escape, the
// outside press and focus return live with the shell and are proven in
// src/components/popover. The Active Threads popover is still hand-rolled,
// so its own dismissal is checked here too. Neither menu may lay an
// invisible backdrop over the window that eats the click the user aimed at
// something else.
import { Children, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  effects: [] as EffectCallback[],
  bots: [] as unknown[],
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(fixture.values[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = { current: initial };
    return fixture.values[index];
  },
  useCallback: (callback: unknown) => callback,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: (effect: EffectCallback) => { fixture.effects.push(effect); },
  useLayoutEffect: () => {},
}));
vi.mock("react-dom", () => ({ createPortal: (node: ReactNode) => node }));
vi.mock("./MenuMotion", () => ({
  useMenuMotion: (open: boolean) => ({ shown: open, closing: false, className: "", exitProps: {} }),
  useHeldMenuMotion: (value: unknown) => ({ shown: value !== null, value, closing: false, className: "", exitProps: {} }),
}));
vi.mock("./DesktopCapabilities", async () => {
  const { initialDesktopCapabilities } = await import("@/lib/desktop");
  return { useDesktopCapabilities: () => ({ capabilities: initialDesktopCapabilities() }) };
});
vi.mock("@/lib/thread-preferences", () => ({ useShowThreads: () => true }));
// The Active Threads menu is an Advanced-mode control; Simple hides it.
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({ state: { ...original.initialState, bots: fixture.bots }, dispatch: vi.fn() }),
  };
});

import { Sidebar } from "./Sidebar";
import { SidebarNewChatPanel } from "./SidebarNewChatPanel";
import { PopoverMenu } from "./popover/PopoverMenu";

type Props = { children?: ReactNode; className?: string; onClick?: () => void; [key: string]: unknown };
function nodes(value: ReactNode): ReactElement<Props>[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement<Props>(child)) return [];
    return [child, ...nodes(child.props.children)];
  });
}
function render() {
  fixture.index = 0;
  fixture.effects = [];
  return nodes(Sidebar({ open: false, onClose: () => {} }));
}
const trigger = (label: string) => render().find((node) => node.type === "button" && node.props["aria-label"] === label)!;
type PlusMenu = { ariaLabel: string; placement?: string; align?: string; items: Array<{ key: string; title?: string; value?: string; onSelect?: () => void }> };
const plusMenu = (label = "New or share") => render().find((node) => node.type === PopoverMenu && node.props.ariaLabel === label)! as unknown as ReactElement<PlusMenu>;

let window: EventTarget;
function runEffects() {
  // the sidebar's other effects reach for desktop bridges this test does not
  // stub; only the listeners they manage to bind matter here
  for (const effect of fixture.effects) {
    try { effect(); } catch { /* unrelated effect */ }
  }
}
function key(name: string, prevented = false) {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key: name, isComposing: false });
  if (prevented) event.preventDefault();
  window.dispatchEvent(event);
  return event;
}
function press(target: unknown) {
  const event = new Event("pointerdown");
  Object.defineProperty(event, "target", { value: target });
  window.dispatchEvent(event);
}
const text = (tree: ReactElement<Props>[]) => tree.map((node) => Children.toArray(node.props.children).filter((child) => typeof child === "string").join(" ")).join(" ");

beforeEach(() => {
  fixture.values = [];
  fixture.bots = [];
  window = new EventTarget();
  vi.stubGlobal("window", Object.assign(window, { innerWidth: 1280, innerHeight: 800, ogb: undefined, setTimeout, clearTimeout }));
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("sidebar header menu: New or share", () => {
  it("leads with New chat and carries the sidebar's creation rows", () => {
    const menu = plusMenu();
    expect(menu.props.placement).toBe("below");
    expect(menu.props.align).toBe("end");
    expect(menu.props.items.map((item) => item.key)).toEqual([
      "new-chat",
      "new-bot",
      "new-group",
      "create-team",
      "templates",
    ]);
    expect(menu.props.items[0]!.title).toBe("New chat");
    expect(menu.props.items.map((item) => item.title)).toContain("Create team");
  });

  it("drops teams and templates from a remote client's window", () => {
    vi.stubGlobal("window", Object.assign(new EventTarget(), {
      innerWidth: 1280, innerHeight: 800, ogb: { remoteClient: { active: true } }, setTimeout, clearTimeout,
    }));
    const menu = plusMenu("New");
    expect(menu.props.items.map((item) => item.key)).toEqual(["new-chat", "new-bot", "new-group"]);
  });

  it("adds Archived bots with its count once a bot is archived", () => {
    fixture.bots = [{ id: "bot", hidden: true }];
    const archived = plusMenu().props.items.at(-1)!;
    expect(archived.key).toBe("archived");
    expect(archived.value).toBe("1");
  });

  it("opens the New chat panel through the leading row", () => {
    expect(render().some((node) => node.type === SidebarNewChatPanel)).toBe(false);
    plusMenu().props.items[0]!.onSelect!();
    vi.stubGlobal("document", { body: {} });
    expect(render().some((node) => node.type === SidebarNewChatPanel)).toBe(true);
  });
});

describe("sidebar header menu: Active Threads", () => {
  const label = "Active Threads";
  const item = "No active threads";
  const open = () => {
    trigger(label).props.onClick!();
    const tree = render();
    expect(text(tree)).toContain(item);
    return tree;
  };

  it("does not cover the window with a click-eating backdrop", () => {
    const tree = open();
    expect(tree.some((node) => /\bfixed\b/.test(node.props.className ?? "") && /\binset-0\b/.test(node.props.className ?? ""))).toBe(false);
  });

  it("closes on Escape and marks the Escape handled", () => {
    open();
    runEffects();
    expect(key("Escape").defaultPrevented).toBe(true);
    expect(text(render())).not.toContain(item);
  });

  it("leaves an Escape that an editor already handled alone", () => {
    open();
    runEffects();
    key("Escape", true);
    expect(text(render())).toContain(item);
  });

  it("closes on a press outside it, and not on one inside it", () => {
    const tree = open();
    // "mount" the innermost element that wraps both the trigger and the menu
    const INSIDE = { closest: () => null };
    const root = tree.filter((node) => {
      const ref = node.props.ref as { current: unknown } | undefined;
      if (!ref || typeof ref !== "object") return false;
      const inner = nodes(node.props.children);
      return inner.some((child) => child.props["aria-label"] === label) && text(inner).includes(item);
    }).at(-1);
    expect(root).toBeDefined();
    (root!.props.ref as { current: unknown }).current = { contains: (target: unknown) => target === INSIDE };
    runEffects();
    press(INSIDE);
    expect(text(render())).toContain(item);
    press({ closest: () => null });
    expect(text(render())).not.toContain(item);
  });
});
