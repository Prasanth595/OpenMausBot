// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { McpServerSummary } from "@/lib/mcp-servers";

const fixture = vi.hoisted(() => ({ api: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(), dispatch: vi.fn(), updateMcpServers: vi.fn() }));
vi.mock("@/state/store", () => ({
  api: fixture.api,
  useStore: () => ({ state: { bots: [{ id: "bot-1", name: "Scout" }, { id: "bot-2", name: "Ghost", hidden: true }] }, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/mcp-servers", () => ({ updateMcpServers: fixture.updateMcpServers, useMcpServers: vi.fn() }));

import { LocalAppRow } from "./LocalAppRow";

const KEY = "fixture-trello-key";
const TOKEN = "fixture-trello-token";

let host: HTMLDivElement;
let root: Root;
let probe: { ok: boolean; error?: string };

const settle = () => act(async () => { for (let turn = 0; turn < 5; turn += 1) await Promise.resolve(); });
const button = (label: string) => [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label);
const requests = () => fixture.api.mock.calls.map(([path, init]) => [init?.method ?? "GET", path, init?.body ? JSON.parse(String(init.body)) : undefined]);

async function show(slug: string, server?: McpServerSummary) {
  await act(async () => root.render(createElement(LocalAppRow, { slug, label: "Trello", server, onChange: vi.fn() })));
}

async function type(name: string, value: string) {
  const input = [...host.querySelectorAll("label")].find((label) => label.textContent?.startsWith(name))!.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setLocale("en");
  probe = { ok: true };
  fixture.api.mockImplementation((path: string) => {
    if (path === "/api/mcp/servers/trello/test") return Promise.resolve(probe);
    if (path.startsWith("/api/mcp/servers")) return Promise.resolve({ servers: [] });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("Running a catalog app on this computer", () => {
  it("shows the command, takes each credential once, then saves, tests and starts it over this computer's own server", async () => {
    await show("trello");
    await act(async () => button("Run on this computer")!.click());
    expect(host.querySelector("code")?.textContent).toBe("npx -y @delorenj/mcp-server-trello@1.8.1");
    expect(host.querySelector<HTMLAnchorElement>("a[href='https://github.com/delorenj/mcp-server-trello']")).not.toBeNull();
    expect([...host.querySelectorAll("input")].map((input) => input.type)).toEqual(["password", "password"]);
    expect(button("Test and start")!.disabled).toBe(true);
    await type("TRELLO_API_KEY", KEY);
    await type("TRELLO_TOKEN", TOKEN);
    await act(async () => button("Test and start")!.click());
    await settle();
    expect(requests()).toEqual([
      ["POST", "/api/mcp/servers", { name: "trello", command: "npx", args: ["-y", "@delorenj/mcp-server-trello@1.8.1"], env: { TRELLO_API_KEY: KEY, TRELLO_TOKEN: TOKEN }, localApp: "trello" }],
      ["POST", "/api/mcp/servers/trello/test", undefined],
      ["PATCH", "/api/mcp/servers/trello", { enabled: true }],
    ]);
    expect(host.innerHTML).not.toContain(KEY);
    expect(host.innerHTML).not.toContain(TOKEN);
    expect(button("Run on this computer")).toBeDefined();
  });

  it("leaves it saved and off with the server's reason when it does not start", async () => {
    probe = { ok: false, error: "spawn npx ENOENT" };
    await show("trello");
    await act(async () => button("Run on this computer")!.click());
    await type("TRELLO_API_KEY", KEY);
    await type("TRELLO_TOKEN", TOKEN);
    await act(async () => button("Test and start")!.click());
    await settle();
    expect(requests().map(([method, path]) => `${method} ${path}`)).toEqual(["POST /api/mcp/servers", "POST /api/mcp/servers/trello/test"]);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("It is saved, but it did not start: spawn npx ENOENT");
  });

  it("starts a saved one without asking again, and once running points to each bot's own choice", async () => {
    await show("trello", { name: "trello", enabled: false, localApp: "trello" });
    expect(host.querySelector("input")).toBeNull();
    await act(async () => button("Test and start")!.click());
    await settle();
    expect(requests().map(([method, path]) => `${method} ${path}`)).toEqual(["POST /api/mcp/servers/trello/test", "PATCH /api/mcp/servers/trello"]);
    await show("trello", { name: "trello", enabled: true, localApp: "trello" });
    expect(host.textContent).toContain("Runs on this computer");
    expect(host.textContent).toContain("No bot uses it until you turn on trello in that bot’s Access settings.");
    expect([...host.querySelectorAll("details button")].map((element) => element.textContent)).toEqual(["Choose for Scout"]);
    await act(async () => button("Choose for Scout")!.click());
    expect(fixture.dispatch.mock.calls).toEqual([
      [{ type: "togglePlugins", open: false }],
      [{ type: "toggleSettings", open: true, section: "access", botId: "bot-1" }],
    ]);
  });

  it("says where a local app runs when it is pinned to another computer, and offers to start nothing here", async () => {
    await show("trello", { name: "trello", enabled: true, localApp: "trello", runsOn: { label: "Milind's MacBook" } });
    expect(host.textContent).toBe("Runs on Milind's MacBook, so it isn't started here.");
    expect(host.querySelector("button")).toBeNull();
  });

  it("offers nothing for an app with no local recipe", async () => {
    await show("gmail");
    expect(host.innerHTML).toBe("");
  });
});
