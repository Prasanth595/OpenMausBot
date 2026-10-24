// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskUsage } from "@/state/store";

type Props = Parameters<typeof import("./ChatPlanAllowance").ChatPlanAllowance>[0];

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/api", () => ({ api: fixture.api }));

const { ChatPlanAllowance } = await import("./ChatPlanAllowance");
const { setUsageDisplay } = await import("@/lib/usage-display-preferences");

const row = (id: string, name: string, remaining: number) => ({
  id, name, ok: true,
  fiveHour: { available: true, remainingPercent: remaining, usedPercent: 100 - remaining, resetsAt: new Date(Date.now() + 3_600_000 * 2.5).toISOString() },
});
const report = { providers: [row("codex", "Codex", 80), row("claude", "Claude", 34)] };
const usage = (tokens: number): TaskUsage => ({ input: 0, output: 0, costUsd: null, turns: 0, context: { tokens } });

let host: HTMLDivElement;
let root: Root;
const text = () => host.textContent ?? "";
const strip = () => host.querySelector('[data-testid="chat-plan-allowance"]');
const tab = () => host.querySelector<HTMLButtonElement>('[data-testid="chat-usage-tab"] button');
const popup = () => host.querySelector('[data-testid="chat-usage-popup"]');

const render = (botInstance: string, taskInstance: string | undefined, tokens: number) => flushSync(() => root.render(createElement(ChatPlanAllowance, {
  bot: { modelSelection: { instanceId: botInstance } },
  task: { modelSelection: taskInstance ? { instanceId: taskInstance } : undefined, usage: usage(tokens) },
} as Props)));

async function show(instanceId: string, tokens = 24_700, taskInstance?: string) {
  render(instanceId, taskInstance, tokens);
  await vi.waitFor(() => expect(fixture.api).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
  setUsageDisplay("always");
  fixture.api.mockReset();
  fixture.api.mockResolvedValue(report);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("usage display modes", () => {
  it("Always shows provider, percentage, reset, meter and context for the subscription provider", async () => {
    await show("claude");
    expect(strip()).not.toBeNull();
    expect(tab()).toBeNull();
    expect(text()).toContain("Claude");
    expect(text()).toContain("34% left");
    expect(text()).toContain("resets in 2h");
    expect(text()).toContain("ctx 24.7k");
    expect(host.querySelector('[role="meter"]')).not.toBeNull();
    expect(text()).not.toContain("Codex");
  });

  it("Hide shows only a Usage tab; clicking opens a pop-up with the same information", async () => {
    setUsageDisplay("hide");
    await show("claude");
    expect(strip()).toBeNull();
    expect(tab()?.textContent).toBe("Usage");
    expect(popup()).toBeNull();
    flushSync(() => tab()!.click());
    expect(popup()?.textContent).toContain("Claude");
    expect(popup()?.textContent).toContain("34% left");
    expect(popup()?.textContent).toContain("ctx 24.7k");
    expect(popup()?.querySelector('[role="meter"]')).not.toBeNull();
    flushSync(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(popup()).toBeNull();
  });

  it("Never shows neither strip nor tab, and does not poll", async () => {
    setUsageDisplay("never");
    render("claude", undefined, 24_700);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.innerHTML).toBe("");
    expect(fixture.api).not.toHaveBeenCalled();
  });
});

describe("effective provider", () => {
  it("free/local providers show context only, never a Codex or Claude allowance", async () => {
    await show("ollama-local");
    expect(text()).toBe("ctx 24.7k");
    expect(host.querySelector('[role="meter"]')).toBeNull();
  });

  it("free/local with no context shows nothing, in Hide mode too", async () => {
    setUsageDisplay("hide");
    await show("ollama-local", 0);
    expect(host.innerHTML).toBe("");
  });

  it("a thread-level override shows that thread's provider, not the bot default", async () => {
    await show("codex", 24_700, "claude");
    expect(text()).toContain("Claude");
    expect(text()).toContain("34% left");
    expect(text()).not.toContain("Codex");
  });

  it("a thread overridden onto a free/local model drops the bot's subscription allowance", async () => {
    await show("claude", 24_700, "ollama-local");
    expect(text()).toBe("ctx 24.7k");
  });
});
