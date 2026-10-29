import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { removeTempDir } from "../testing/cleanup.ts";
import { BrowserEgress } from "./egress/registry.ts";
import { ChromeEngine } from "./engines.ts";

it.skipIf(!process.env.OMB_BRAVE_PATH)("runs a selected Brave through the bot engine with its own profile", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omb-brave-"));
  const egress = new BrowserEgress();
  egress.configure({ host: "desktop", config: () => undefined });
  const engine = new ChromeEngine({ dataDir, browser: "brave", host: "container", egressPort: (key) => egress.open(key), egressNotice: (key) => egress.takeNotice(key), idleMs: () => 600_000 });
  const target = { session: "brave-smoke", key: "bot:brave-smoke" };
  try {
    expect(engine.launcher.plan()).toMatchObject({ kind: "chrome", chrome: { source: "brave", path: process.env.OMB_BRAVE_PATH }, fallback: null });
    const url = "data:text/html," + encodeURIComponent('<!doctype html><title>Brave fixture</title><button onclick="this.textContent=\'Clicked\'">Try Brave</button>');
    const result = await engine.service.agentRpc(target, "tools/call", { name: "agent_browser_open", arguments: { url } }) as { isError?: boolean };
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(engine.summary()).toMatchObject({ kind: "engine", chrome: expect.stringContaining("Brave") });
    const screenshot = await engine.service.agentRpc(target, "tools/call", { name: "agent_browser_screenshot", arguments: {} }) as { isError?: boolean; content: Array<{ type: string }> };
    expect(screenshot.isError, JSON.stringify(screenshot)).not.toBe(true);
    expect(screenshot.content.some((part) => part.type === "image")).toBe(true);
  } finally {
    await engine.close();
    await egress.close();
    await removeTempDir(dataDir);
  }
}, 60_000);
