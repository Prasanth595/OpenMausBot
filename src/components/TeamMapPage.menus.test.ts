// The team map's two menus — the header's Add pill and a team tile's "…" —
// were hand-rolled <details> dropdowns; they are the shared PopoverMenu now.
// What is proven here is the wiring: the rows each one builds, which row
// calls which callback, and the accessible names. Escape, the outside press,
// focus return and the portal placement live with the shell, in ./popover.
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot } from "@/state/store";
import type { TeamMapSection } from "@/lib/team-map";
import type { PopoverMenuItem } from "./popover/PopoverMenu";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", { ogb: undefined });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { state: undefined as AppState | undefined, dispatch: vi.fn() };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: fixture.state ?? original.initialState, dispatch: fixture.dispatch }) };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { host: {}, dictation: { available: false } }, ready: true }),
  useCaptionChrome: () => ({}),
}));

const { initialState } = await import("@/state/store");
const { TeamMapPage } = await import("./TeamMapPage");
const { TeamCanvas } = await import("./TeamCanvas");
const { PopoverMenu } = await import("./popover/PopoverMenu");

const bot = (id: string, name: string, section: string): Bot => ({
  id, threadId: `${id}-thread`, name, title: "", description: "", section, color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "claude", model: "m" },
});
const general = bot("ada", "Ada", "");
const research = bot("rio", "Rio", "Research");
const sections: TeamMapSection<Bot>[] = [
  { key: "", name: "General", chiefs: [], members: [general] },
  { key: "Research", name: "Research", chiefs: [], members: [research] },
];

type MenuProps = { ariaLabel: string; placement?: string; align?: string; width?: number; items: PopoverMenuItem[] };
/** The component's returned controls under React's hook dispatcher, plus the
 * markup its triggers paint. */
function render(render: () => ReactNode) {
  let tree!: ReactNode;
  function Capture() { tree = render(); return tree; }
  const html = renderToStaticMarkup(createElement(Capture));
  const menus: ReactElement<MenuProps>[] = [];
  const visit = (node: ReactNode) => Children.toArray(node).forEach((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return;
    if (child.type === PopoverMenu) menus.push(child as ReactElement<MenuProps>);
    visit(child.props.children);
  });
  visit(tree);
  return { html, menus };
}
const menuNamed = (menus: ReactElement<MenuProps>[], label: string) => menus.find((element) => element.props.ariaLabel === label)!;
const addMenu = () => menuNamed(render(() => TeamMapPage()).menus, "Add to team map");
const canvasProps = (overrides: Partial<Parameters<typeof TeamCanvas>[0]> = {}): Parameters<typeof TeamCanvas>[0] => ({
  sections,
  canManage: true,
  onMove: async () => true,
  onInstructions: vi.fn(),
  onMemory: vi.fn(),
  onEditTeam: vi.fn(),
  onDeleteTeam: vi.fn(),
  isEmpty: () => false,
  ...overrides,
});
const teamMenu = (section: string, overrides: Partial<Parameters<typeof TeamCanvas>[0]> = {}) =>
  render(() => TeamCanvas(canvasProps(overrides))).menus.find((element) => element.props.ariaLabel === `Manage ${section} team`)!;

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.state = { ...initialState, bots: [general, research], sections: ["Research"] };
});
afterAll(() => vi.unstubAllGlobals());

describe("the team map header's Add menu", () => {
  it("offers a team, a cloud computer, and the Local VM only where the server has one", () => {
    const items = addMenu().props.items;
    expect(items.map(({ key, title }) => [key, title])).toEqual([
      ["team", "Create team"],
      ["cloud", "Cloud computer"],
      ["local-vm", "Local VM…"],
    ]);
    // An OMB Cloud home has no Local VM (shared/cloud-home.ts).
    fixture.state = { ...fixture.state!, config: { cloudHome: true } as AppState["config"] };
    expect(addMenu().props.items.map((item) => item.key)).toEqual(["team", "cloud"]);
  });

  it("hangs right-aligned under the pill and opens the computer settings from its VM row", () => {
    const menu = addMenu();
    expect(menu.props.placement).toBe("below");
    expect(menu.props.align).toBe("end");
    expect(menu.props.width).toBe(208);
    menu.props.items.find((item) => item.key === "local-vm")!.onSelect!();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", section: "computer", open: true });
  });
});

describe("a team tile's overflow menu", () => {
  it("hangs right-aligned under the button with the team's own rows", () => {
    const menu = teamMenu("Research");
    expect(menu.props.placement).toBe("below");
    expect(menu.props.align).toBe("end");
    expect(menu.props.width).toBe(220);
    expect(menu.props.items.map(({ key, title }) => [key, title])).toEqual([
      ["move", "Move bots to Research"],
      ["instructions", "Shared instructions"],
      ["memory", "Team memory"],
      ["rename", "Rename team"],
      ["delete", "Delete team"],
    ]);
    // The override replaces the row's fill, so the danger tone brings its
    // own — and none of it while the row is disabled.
    expect(menu.props.items.find((item) => item.key === "delete")!.overrideClassNames).toEqual({
      row: "text-danger hover:bg-danger/10 disabled:hover:bg-transparent",
      leading: "text-danger",
    });
  });

  it("calls the same team callbacks each row always did", () => {
    const props = canvasProps();
    const items = menuNamed(render(() => TeamCanvas(props)).menus, "Manage Research team").props.items;
    const select = (key: string) => items.find((item) => item.key === key)!.onSelect!();
    select("move");
    expect(props.onEditTeam).toHaveBeenCalledWith("Research");
    select("instructions");
    expect(props.onInstructions).toHaveBeenCalledWith("Research", "Research");
    select("memory");
    expect(props.onMemory).toHaveBeenCalledWith("Research", "Research");
    select("rename");
    expect(props.onEditTeam).toHaveBeenCalledWith("Research", true);
    select("delete");
    expect(props.onDeleteTeam).toHaveBeenCalledWith("Research");
  });

  it("offers General neither rename nor delete, and no team memory where none exists", () => {
    expect(teamMenu("General").props.items.map((item) => item.key)).toEqual(["move", "instructions", "memory"]);
    expect(teamMenu("General").props.items[0]!.title).toBe("Move bots to General");
    expect(teamMenu("Research", { onMemory: undefined }).props.items.map((item) => item.key))
      .toEqual(["move", "instructions", "rename", "delete"]);
  });

  it("names each trigger after the team it manages, and the Add pill after the map", () => {
    const { html } = render(() => TeamCanvas(canvasProps()));
    expect(html).toContain('aria-label="Manage Research team"');
    expect(html).toContain('aria-label="Manage General team"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(render(() => TeamMapPage()).html).toContain('aria-label="Add to team map"');
  });
});
