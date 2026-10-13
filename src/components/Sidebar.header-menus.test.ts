// The sidebar header's menus — New or share (+) and Active Threads. Both are
// the shared PopoverMenu now, so what is proven here is the wiring: which
// rows each one builds, what each row opens, and the band's own control.
// Escape, the outside press and focus return live with the shell and are
// proven in src/components/popover. Neither menu may lay an invisible
// backdrop over the window that eats the click the user aimed at something
// else.
import { Children, isValidElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  effects: [] as EffectCallback[],
  bots: [] as unknown[],
  dispatch: vi.fn(),
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
    useStore: () => ({ state: { ...original.initialState, bots: fixture.bots }, dispatch: fixture.dispatch }),
  };
});

import { Sidebar } from "./Sidebar";
import { SidebarNewChatPanel } from "./SidebarNewChatPanel";
import { PopoverMenu } from "./popover/PopoverMenu";
import { t } from "@/lib/i18n";

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
type PlusMenu = { ariaLabel: string; placement?: string; align?: string; items: Array<{ key: string; title?: string; value?: string; onSelect?: () => void }> };
/** Finds the header's plus menu by its accessible label. */
const plusMenu = (label = "New or share") => render().find((node) => node.type === PopoverMenu && node.props.ariaLabel === label)! as unknown as ReactElement<PlusMenu>;

const text = (tree: ReactElement<Props>[]) => tree.map((node) => Children.toArray(node.props.children).filter((child) => typeof child === "string").join(" ")).join(" ");

beforeEach(() => {
  fixture.values = [];
  fixture.index = 0;
  fixture.bots = [];
  fixture.dispatch.mockClear();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { innerWidth: 1280, innerHeight: 800, ogb: undefined, setTimeout, clearTimeout }));
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
  type AttentionItem = {
    key: string;
    title?: ReactNode;
    content?: ReactNode;
    hint?: string;
    header?: { title?: ReactNode; content?: ReactElement<Props> };
    render?: ReactElement<Props>;
    onSelect?: () => void;
  };
  type AttentionMenu = { ariaLabel: string; placement?: string; align?: string; width?: number; sheetAriaLabel?: string; items: AttentionItem[] };
  const attentionMenu = () => render().find((node) => node.type === PopoverMenu && String(node.props.ariaLabel).startsWith(label))! as unknown as ReactElement<AttentionMenu>;
  const bandPin = () => attentionMenu().props.items[0]!.header!.content!;

  it("hangs below the bell, right-aligned, under the panel's own name", () => {
    const menu = attentionMenu();
    expect(menu.props.ariaLabel).toBe(label);
    expect(menu.props.placement).toBe("below");
    expect(menu.props.align).toBe("end");
    expect(menu.props.width).toBe(288);
    expect(menu.props.sheetAriaLabel).toBe(label);
    const [band, empty] = menu.props.items;
    expect(band!.header!.title).toBe(label);
    expect(bandPin().props["aria-label"]).toBe("Pin");
    expect(text([empty!.render!])).toBe("No active threads");
    // no click-eating backdrop, whatever the rows do
    expect(render().some((node) => /\bfixed\b/.test(node.props.className ?? "") && /\binset-0\b/.test(node.props.className ?? ""))).toBe(false);
  });

  it("jumps to the thread a row is picked for", () => {
    fixture.bots = [{
      id: "atlas", threadId: "atlas-thread", name: "Atlas", unread: false, busy: false,
      tasks: [{ threadId: "approval", title: "Review permission", createdAt: 0, activity: "waiting-on-you" }],
    }];
    const items = attentionMenu().props.items;
    expect(items).toHaveLength(2);
    const row = items[1]!;
    expect(row.title).toBe("Review permission");
    expect(row.content).toBe(`Atlas · ${t("task.waiting")}`);
    expect(row.hint).toBe(t("attention.item", { title: "Review permission", name: "Atlas", status: t("task.waiting") }));
    row.onSelect!();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "switchTask", botId: "atlas", threadId: "approval" });
  });

  it("pins the panel in place from the band, and unpins it again", () => {
    expect(bandPin().props["aria-label"]).toBe("Pin");
    bandPin().props.onClick!();
    expect(bandPin().props["aria-label"]).toBe("Unpin");
    bandPin().props.onClick!();
    expect(bandPin().props["aria-label"]).toBe("Pin");
  });
});
