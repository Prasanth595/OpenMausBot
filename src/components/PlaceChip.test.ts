// @vitest-environment happy-dom
// The chip's trigger and its place picker (the shared PopoverMenu): a real
// click opens the sheet, so the rows proved here are the ones a person sees.
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => ({ config: null as unknown, computerMcp: true }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: {
        ...original.initialState,
        config: fixture.config ?? original.initialState.config,
        instances: [{
          instanceId: "test",
          driverKind: "grokAgent",
          displayName: "Grok",
          snapshot: { state: "available" },
          capabilities: { computerMcp: fixture.computerMcp, browserMcp: true },
        } as InstanceInfo],
      },
      dispatch: vi.fn(),
    }),
  };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({
    capabilities: {
      dictation: { available: false },
      host: { packaged: true, platform: "darwin" },
      localComputer: { available: true, support: "supported", enabled: true, status: "enabled" },
    },
    ready: true,
  }),
}));

const { PlaceChip, usePlaceAvailability } = await import("./PlaceChip");

const bot = {
  id: "bot",
  threadId: "thread",
  name: "Rio",
  title: "",
  description: "",
  color: "green",
  notifications: true,
  unread: false,
  busy: false,
  messages: [],
  computer: "local",
  modelSelection: { instanceId: "test", model: "grok-4.6" },
} as Bot;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Nothing here talks to the server; a real stack would reach for it.
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  document.documentElement.dataset.reducedMotion = "true";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.reducedMotion;
  vi.unstubAllGlobals();
  fixture.config = null;
  fixture.computerMcp = true;
});

const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-label^="Where this conversation works"]')!;
/** The open menu's radio rows: whether each is checked, its words and its
 * native tooltip. The words read the row's own column (title, then the
 * content line under it), so the icon contributes nothing. */
const rows = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].map((row) => {
  const column = row.querySelector<HTMLElement>("span > span")?.parentElement;
  return {
    checked: row.getAttribute("aria-checked") === "true",
    disabled: row.hasAttribute("disabled"),
    hint: row.getAttribute("title") ?? undefined,
    text: [...(column?.children ?? [])].map((slot) => slot.textContent ?? "").join(" "),
  };
});
const open = async (props: Partial<ComponentProps<typeof PlaceChip>> = {}) => {
  act(() => {
    root.render(createElement(PlaceChip, { bot, live: false, onPin: () => {}, ...props }));
  });
  await act(async () => trigger().click());
  return rows();
};

describe("PlaceChip composer trigger", () => {
  it("is icon-only, with the place name in the accessible name and tooltip", () => {
    const html = renderToStaticMarkup(createElement(PlaceChip, {
      bot,
      live: false,
      onPin: () => {},
    } satisfies ComponentProps<typeof PlaceChip>));
    expect(html).toContain('data-testid="place-chip"');
    expect(html).toContain('aria-label="Where this conversation works: This computer"');
    expect(html).toContain("This computer — From this bot&#x27;s Works on setting");
    expect(html).not.toMatch(/<span class="truncate">This computer<\/span>/);
  });
});

describe("the menu's first row", () => {
  it("is Auto itself for a bot on Auto, selected while the conversation has no pin", async () => {
    const menu = await open({ bot: { ...bot, computer: undefined } });
    expect(menu[0]).toMatchObject({ checked: true, text: "Auto Picks the right place for each task" });
    expect(host.innerHTML).not.toContain("Follow this bot");
    expect(trigger().getAttribute("aria-label")).toBe("Where this conversation works: Auto");
    // Auto once, then the four places as before: no second Auto row.
    expect(menu).toHaveLength(5);
    expect(menu.filter((row) => row.text.startsWith("Auto"))).toHaveLength(1);
  });

  it("stays Auto, unchecked, when the conversation is pinned elsewhere", async () => {
    const menu = await open({ bot: { ...bot, computer: undefined }, task: { surface: "vm" } });
    expect(menu[0]).toMatchObject({ checked: false, text: "Auto Picks the right place for each task" });
    expect(menu.find((row) => row.checked)?.text).toBe("Local VM Isolated local desktop");
    expect(host.querySelector('button[aria-label="Where this conversation works: Local VM"]')).not.toBeNull();
  });

  it("keeps following the bot's setting when the bot works on a specific place", async () => {
    const menu = await open({ bot: { ...bot, computer: "local" } });
    expect(menu[0]).toMatchObject({ checked: true, text: "Follow this bot's setting Currently This computer" });
    expect(host.innerHTML).not.toContain("Picks the right place for each task");
  });

  it("names the band the chip's own title", async () => {
    await open();
    const band = document.querySelector<HTMLElement>("[data-popover-header]")!;
    expect(band.textContent).toBe("Where this conversation works");
  });
});

describe("the places a conversation can be pinned to", () => {
  const availability = () => {
    let seen: ReturnType<typeof usePlaceAvailability> | undefined;
    function Probe() { seen = usePlaceAvailability(bot); return null; }
    renderToStaticMarkup(createElement(Probe));
    return seen!;
  };

  it("reaches this computer and a Local VM on a desktop or self-hosted server", () => {
    expect(availability()).toMatchObject({ cloud: true, vm: true, local: true });
  });

  it("never reaches them on an OMB Cloud home", () => {
    fixture.config = { cloudHome: true };
    expect(availability()).toMatchObject({ cloud: true, vm: false, local: false });
  });
});

describe("J11: the chip names a place's problem in the panel's words", () => {
  it("greys out the cloud computer for a model that can't use one, with the same few words and line", async () => {
    fixture.computerMcp = false;
    const menu = await open();
    const cloud = menu.find((row) => row.text.startsWith("Cloud computer"))!;
    expect(cloud.disabled).toBe(true);
    expect(cloud.text).toBe("Cloud computer Not with this model");
    expect(cloud.hint).toContain("grok-4.6 can't use a computer. Choose a model that can, such as Claude or ChatGPT.");
  });
});
