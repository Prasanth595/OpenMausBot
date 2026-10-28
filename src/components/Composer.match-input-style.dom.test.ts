// @vitest-environment happy-dom
// Simple mode sizes the composer away from the stylesheet, so the mention mirror must copy the textarea's metrics.
// Advanced mode keeps the stylesheet's metrics and must not receive the flag.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { restoreComposerDraft } from "@/lib/drafts";

const fixture = vi.hoisted(() => ({
  advanced: false,
  matchInputStyle: undefined as boolean | undefined,
  bot: {
    id: "atlas", threadId: "atlas-thread", name: "Atlas", title: "", description: "",
    color: "purple", notifications: false, unread: false, busy: false, messages: [], approvalMode: "ask",
    modelSelection: { instanceId: "claude", model: "fake" },
  } as Bot,
}));

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({
    state: { ...original.initialState, bots: [fixture.bot] },
    dispatch: vi.fn(),
  }) };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/cloud-guest", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/cloud-guest")>(), useReactor: () => "user" }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: vi.fn() }));
vi.mock("./CallView", () => ({ CallButton: () => null }));
vi.mock("./GroupCallView", () => ({ GroupCallButton: () => null }));
vi.mock("./MentionTextarea", () => ({
  MentionTextarea: (props: { matchInputStyle?: boolean }) => {
    fixture.matchInputStyle = props.matchInputStyle;
    return null;
  },
}));

import { Composer } from "./Composer";

const bot = fixture.bot;

let root: Root;
let container: HTMLDivElement;
const render = () => flushSync(() => root.render(createElement(Composer, { bot })));

beforeEach(() => {
  fixture.advanced = false;
  fixture.matchInputStyle = undefined;
  restoreComposerDraft(`bot:${bot.id}:${bot.threadId}`, { text: "", attachments: [] });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the composer's mirror metrics", () => {
  it("passes matchInputStyle to the mention field in Simple mode and withholds it in Advanced", () => {
    render();
    expect(fixture.matchInputStyle).toBe(true);
    fixture.advanced = true;
    render();
    expect(fixture.matchInputStyle).toBe(false);
  });
});
