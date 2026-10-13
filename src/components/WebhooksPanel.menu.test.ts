// The webhook detail header's overflow menu was a hand-rolled <details>
// dropdown; it is the shared PopoverMenu now. What is proven here is the
// wiring: the rows the panel builds, the fill Delete brings its own (an
// override drops the row's default one), and the trigger's accessible name.
// Escape, the outside press and focus return live with the shell, in
// ./popover.
import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot } from "@/state/store";
import type { PopoverMenuItem } from "./popover/PopoverMenu";
import type { WebhookTrigger } from "@/lib/webhooks";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", { ogb: undefined });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { state: undefined as AppState | undefined, dispatch: vi.fn() };
});
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: fixture.state ?? original.initialState, dispatch: fixture.dispatch }) };
});

const { initialState } = await import("@/state/store");
const { WebhooksPanel } = await import("./WebhooksPanel");
const { PopoverMenu } = await import("./popover/PopoverMenu");

const bot = {
  id: "scout", threadId: "scout-thread", name: "Scout", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "claude", model: "m" },
} as Bot;
const webhook: WebhookTrigger = {
  id: "hook", endpointId: "ep-hook", name: "Panko webhook", prompt: "", botId: bot.id, runOn: "maus",
  enabled: true, createdAt: 1, updatedAt: 1, deliveryCount: 4, lastReceivedAt: 1,
};

type MenuProps = { ariaLabel: string; placement?: string; align?: string; width?: number; items: PopoverMenuItem[] };
/** The panel's returned controls under React's hook dispatcher, plus the
 * markup the trigger itself paints. */
function render() {
  let tree!: ReactNode;
  function Capture() { tree = WebhooksPanel({ bots: [bot], createRequest: 0, onCreateHandled: () => {} }); return tree; }
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
const overflowMenu = () => render().menus.find((element) => element.props.ariaLabel === "Webhook actions")!;

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.state = { ...initialState, bots: [bot], webhooks: [webhook] };
});
afterAll(() => vi.unstubAllGlobals());

describe("the webhook detail header's overflow menu", () => {
  it("hangs Edit settings and Delete under the button, right-aligned", () => {
    const menu = overflowMenu();
    expect(menu).toBeDefined();
    expect(menu.props.placement).toBe("below");
    expect(menu.props.align).toBe("end");
    expect(menu.props.width).toBe(180);
    expect(menu.props.items.map(({ key, title }) => [key, title])).toEqual([
      ["edit", "Edit settings"],
      ["delete", "Delete"],
    ]);
  });

  it("keeps Delete's own danger fill, and none of it while the row is disabled", () => {
    const items = overflowMenu().props.items;
    expect(items.find((item) => item.key === "delete")!.overrideClassNames).toEqual({
      row: "text-danger hover:bg-danger/10 disabled:hover:bg-transparent",
      leading: "text-danger",
    });
    expect(items.find((item) => item.key === "edit")!.overrideClassNames).toBeUndefined();
  });

  it("names the trigger as the menu, since the icon says nothing", () => {
    const { html } = render();
    expect(html).toContain('aria-label="Webhook actions"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
  });
});
