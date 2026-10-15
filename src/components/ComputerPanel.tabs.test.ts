// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo } from "@/state/store";
import { setLocale, t } from "@/lib/i18n";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useCaptionChrome: () => ({ padClass: undefined }),
  useDesktopCapabilities: () => ({
    ready: true,
    capabilities: {
      host: { platform: "darwin", label: "Host", session: "unknown", packaged: true, homeDir: "/Users/me" },
      windowChrome: "native",
      screenPreview: { available: false, interaction: "none" },
      dictation: { available: false, engine: "none", onDevice: false },
      localComputer: { available: false, support: "unsupported", enabled: false, status: "unavailable" },
    },
  }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("./CloudScreenPreview", () => ({ CloudScreenPreview: () => null }));
const panelViewStore = vi.hoisted(() => ({ current: "computer" }));
vi.mock("@/lib/computer-panel-view", () => ({
  readComputerPanelView: () => panelViewStore.current,
  writeComputerPanelView: (_botId: string, view: string) => {
    panelViewStore.current = view;
  },
}));
vi.mock("./AndroidDevicePanel", async (importOriginal) => ({
  ...await importOriginal<typeof import("./AndroidDevicePanel")>(),
  AndroidDevicePanel: () => null,
}));
vi.mock("./BrowserPanel", () => ({ BrowserPanel: () => null }));
vi.mock("./CloudBackendPicker", () => ({ CloudBackendPicker: () => null }));
vi.mock("./bot-settings/RoutinesSection", () => ({ RoutinesSection: () => null }));
vi.mock("./data/DataPanel", () => ({ DataPanel: () => createElement("div", { "data-testid": "data-panel" }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: async (path: string) => {
    if (path.startsWith("/api/bots/scout/computer/control")) return { held: false, helpReason: null };
    if (path.startsWith("/api/bots/scout/computer?")) return { surface: "cloud", backend: "box", configured: true, box: { boxId: "bx_23456789", state: "ready" } };
    return {};
  },
}));

const { ComputerPanel } = await import("./ComputerPanel");
const { BotEditorStore, initialState } = await import("@/state/store");

/** Builds an available engine instance snapshot for panel tests. */
const engine = (instanceId: string) => ({
  instanceId, driverKind: "claudeAgent", displayName: instanceId, access: "subscription",
  snapshot: { state: "available", version: "1", authenticated: true },
  models: { default: "m", options: [{ id: "m", label: "M" }] },
  capabilities: { computerMcp: true, browserMcp: true },
}) as InstanceInfo;
/** Builds a Scout bot patch-merged for computer-panel tab tests. */
const makeBot = (patch: Partial<Bot> = {}): Bot => ({
  id: "scout", threadId: "thread", name: "Scout", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, computer: "cloud", messages: [],
  modelSelection: { instanceId: "claude", model: "m" },
  tasks: [{ threadId: "thread", title: "Thread", createdAt: 1, approvalMode: "ask" }],
  ...patch,
}) as unknown as Bot;

let root: Root | null = null;
/** Returns a fresh store value with two engines and a configured box. */
const value = (): Parameters<typeof BotEditorStore>[0]["value"] => ({
  state: { ...initialState, instances: [engine("claude"), engine("codex")], config: { box: { configured: true } } as AppState["config"] } as AppState,
  dispatch: vi.fn(),
  flushBotPatches: async () => null,
  refreshInstances: async () => {},
  refreshModels: async () => {},
});
/** Yields to the event loop so panel effects and retries settle. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};
/** Renders the ComputerPanel for a bot and waits for async state. */
const open = async (bot: Bot) => {
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  flushSync(() => root!.render(createElement(BotEditorStore, { value: value(), children: createElement(ComputerPanel, { bot }) })));
  await settle();
};
/** Finds the header tab button whose label exactly matches. */
const tab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="computer-tabs"] button')].find((candidate) => candidate.textContent?.trim() === label)!;
/** Returns the label of the currently aria-selected header tab. */
const selected = () => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="computer-tabs"] button')].find((candidate) => candidate.getAttribute("aria-selected") === "true")?.textContent?.trim();
/** Returns the accessible name of the header tablist. */
const tabListName = () => document.querySelector('[data-testid="computer-tabs"]')?.getAttribute("aria-label");

beforeAll(() => {
  vi.stubGlobal("ogb", undefined);
});
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  setLocale("en");
});

describe("Computer panel tab", () => {
  it("names the tablist from the active catalog", async () => {
    setLocale("de");
    await open(makeBot());
    // The name screen readers announce follows the language, as the tab
    // labels inside it already do.
    expect(tabListName()).toBe(t("computer.tabsAria"));
    expect(tabListName()).not.toBe("Bot panel view");
  });
  it("stays on Data through a model change and follows a conversation change", async () => {
    await open(makeBot());
    expect(selected()).toBe("Computer");
    flushSync(() => tab("Data").click());
    await settle();
    expect(selected()).toBe("Data");
    await vi.waitFor(() => expect(document.querySelector('[data-testid="data-panel"]')).not.toBeNull());

    await open(makeBot({ modelSelection: { instanceId: "codex", model: "m" } }));
    expect(selected()).toBe("Data");
    expect(document.querySelector('[data-testid="data-panel"]')).not.toBeNull();

    await open(makeBot({ threadId: "thread-2", tasks: [{ threadId: "thread-2", title: "Second", createdAt: 2, approvalMode: "ask" }] } as Partial<Bot>));
    expect(selected()).toBe("Computer");
  });
});
