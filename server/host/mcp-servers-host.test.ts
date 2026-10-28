import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import type { AppConfig } from "../config.ts";
import { claimedNotice, createMcpServersHost } from "./mcp-servers-host.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const IRIS = { id: "iris", name: "Iris" }, PAUL = { id: "paul", name: "Paul" }, ROSA = { id: "rosa", name: "Rosa", mcpServers: [] as string[] };
const NOTES_ONLY = { id: "nina", name: "Nina", toolScope: { allow: ["mcp:notes:*"] } }, NO_SERVERS = { id: "otto", name: "Otto" };

function script(data: string, ...parts: string[]): string {
  const path = join(data, ...parts);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "import mcp\n");
  return path;
}

function setup() {
  const data = mkdtempSync(join(tmpdir(), "omb-mcp-host-"));
  dirs.push(data);
  const cfg: AppConfig = {
    mcpServers: {
      "sketch-suite": { command: "/usr/bin/python3", args: [script(data, "task-workspaces", "iris", "t1", "native-sketch", "server.py")], enabled: true },
      blender: { command: "/usr/bin/python3", args: [script(data, "task-workspaces", "iris", "t2", "blender-mcp", "server.py")], enabled: true },
      "blender-own": { command: "/usr/bin/python3", args: [script(data, "workspaces", "iris", "tools", "blender-mcp", "server.py")], enabled: true },
      notes: { command: "npx", args: ["-y", "@x/notes-mcp"], enabled: true },
      broken: { command: "/usr/bin/false", args: [], enabled: true },
    },
  } as AppConfig;
  const told: Array<{ text: string; about: string }> = [];
  const started: string[] = [];
  const host = createMcpServersHost({
    dataDir: data,
    cfg: () => cfg,
    persist: (next) => { cfg.mcpServers = next; },
    bots: () => [IRIS, PAUL, ROSA, NOTES_ONLY, NO_SERVERS],
    startsServers: (botId) => botId !== NO_SERVERS.id,
    policy: (servers) => servers,
    tell: (text, about) => told.push({ text, about: about.id }),
    // The image's python has no `mcp` module: these start only in Iris's own box, where it is installed.
    start: async (name, server, botId) => {
      started.push(`${name}:${botId}`);
      if (name === "broken") return { ok: false, error: "The server stopped before the MCP handshake finished." };
      return server.command === "/usr/bin/python3" && botId !== "iris" ? { ok: false, error: "No module named 'mcp'" } : { ok: true };
    },
  });
  return { cfg, host, told, started, data };
}

it("moves servers in one bot's folders to that bot once, says so once, and keeps them out of every other bot's turns", async () => {
  const { cfg, host, told, started, data } = setup();
  host.boot();
  await host.health.settled();
  expect(told).toEqual([
    { text: "The Blender, Blender-own and Sketch-suite tools only work for Iris, so they're off for your other bots.", about: "iris" },
    { text: "The Broken tool doesn't start, so it's off for now. It comes back on its own once it starts.", about: "iris" },
  ]);
  expect((cfg.mcpServers!.blender as { args: string[] }).args).toEqual([join(data, "workspaces", "iris", "tools", "blender-mcp-2", "server.py")]);
  expect(Object.keys(host.mounted(IRIS)).sort()).toEqual(["blender", "blender-own", "notes", "sketch-suite"]);
  expect(Object.keys(host.mounted(PAUL)).sort()).toEqual(["notes"]);
  expect(host.mounted(ROSA), "a bot given no servers gets none").toEqual({});
  expect(started.sort(), "Iris's own servers are started for Iris only, every bot's once for all").toEqual(["blender-own:iris", "blender:iris", "broken:iris", "notes:iris", "sketch-suite:iris"]);
  expect(host.off(PAUL)).toEqual([{ name: "broken", error: "The server stopped before the MCP handshake finished." }]);
  expect(host.off(NOTES_ONLY), "a bot whose tool selection never reaches it is not told about it").toEqual([]);
  expect(host.health.offFor("broken"), "nor a bot whose AI starts no servers").toEqual(["iris", "paul"]);

  host.boot();
  await host.health.settled();
  expect(told, "a second start says nothing new").toHaveLength(2);
  host.botDeleted("iris");
  expect(Object.keys(cfg.mcpServers!).sort()).toEqual(["broken", "notes"]);
});

it("says it in one plain line per bot", () => {
  expect(claimedNotice("Iris", ["blender"])).toBe("The Blender tool only works for Iris, so it's off for your other bots.");
});
