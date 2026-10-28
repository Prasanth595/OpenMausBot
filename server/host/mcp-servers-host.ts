// Which config.json MCP servers each bot's turns start: every bot's and the bot's own, minus any that does not start.
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { AppConfig } from "../config.ts";
import { customMcpServers } from "../config.ts";
import type { McpServerSpec, StdioMcpSpec } from "../contracts.ts";
import { addBotMcpServer, claimBotMcpServers, withoutBotMcpServers, type BotMcpServerAdd } from "../mcp-bot-servers.ts";
import { createMcpHealth, nameList, toolLabel, type McpHealthDeps } from "../mcp-health.ts";
import { probeMcpServer } from "../mcp-probe.ts";
import { isRemoteMcpServer, parseStoredMcpServer } from "../mcp-registry.ts";
import { canUseMcpServer } from "../../shared/tool-scope.ts";

type Bot = { id: string; name: string; mcpServers?: string[]; toolScope?: unknown };

export interface McpServersHostDeps {
  dataDir: string;
  cfg(): AppConfig;
  persist(next: Record<string, unknown>): void;
  bots(): readonly Bot[];
  /** The organisation's MCP policy over a bot's servers. */
  policy<T extends object>(servers: Record<string, T>): Record<string, T>;
  /** One plain line for the person about `bot`. */
  tell(text: string, bot: { id: string; name: string }): void;
  /** Whether this bot's AI starts config.json servers at all. */
  startsServers(botId: string): boolean;
  start?: McpHealthDeps["start"];
}

/** What the person hears once when servers in one bot's folder became that bot's own. */
export function claimedNotice(botName: string, names: readonly string[]): string {
  const tools = names.toSorted().map(toolLabel);
  return tools.length === 1
    ? `The ${tools[0]} tool only works for ${botName}, so it's off for your other bots.`
    : `The ${nameList(tools)} tools only work for ${botName}, so they're off for your other bots.`;
}

/** The enabled command servers this computer starts, by name, with the bot each is for. */
export function enabledCommandServers(cfg: AppConfig): Record<string, StdioMcpSpec & { bot?: string }> {
  const out: Record<string, StdioMcpSpec & { bot?: string }> = {};
  for (const [name, raw] of Object.entries(cfg.mcpServers ?? {})) {
    const parsed = parseStoredMcpServer(name, raw);
    if (!parsed.ok || isRemoteMcpServer(parsed.server) || !parsed.server.enabled || parsed.server.runsOn) continue;
    const { command, args, env, bot } = parsed.server;
    out[name] = { command, args, env, ...(bot ? { bot } : {}) };
  }
  return out;
}

export function createMcpServersHost(deps: McpServersHostDeps) {
  const configured = (bot: Bot): Record<string, McpServerSpec> => deps.policy(customMcpServers(deps.cfg(), bot.mcpServers, bot.id));
  /** None on an AI that starts no servers, and only those its tool selection reaches. */
  const started = (bot: Bot): string[] => (deps.startsServers(bot.id) ? Object.keys(configured(bot)).filter((name) => canUseMcpServer(bot.toolScope, name)) : []);
  const start: McpHealthDeps["start"] = deps.start ?? (async (_name, server, botId) => {
    const own = join(deps.dataDir, "workspaces", botId);
    const result = await probeMcpServer({ ...server, enabled: true }, undefined, undefined, { asBot: { id: botId, cwd: existsSync(own) ? own : deps.dataDir } });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });
  const health = createMcpHealth({
    file: join(deps.dataDir, "mcp-health.json"),
    servers: () => enabledCommandServers(deps.cfg()),
    users: (name) => deps.bots().filter((bot) => started(bot).includes(name)),
    start,
    tell: deps.tell,
  });

  return {
    health,
    mounted: (bot: Bot): Record<string, McpServerSpec> => health.usable(bot.id, configured(bot)),
    prepare: (bot: Bot): Promise<void> => health.prepare(bot.id, started(bot)),
    off: (bot: Bot) => health.off(bot.id, started(bot)),
    listing: <T extends { name: string }>(server: T): T & { offFor?: string[] } => {
      const offFor = health.offFor(server.name);
      return offFor.length ? { ...server, offFor } : server;
    },
    botAdd: (current: Record<string, unknown>, body: unknown, botId: string): BotMcpServerAdd => addBotMcpServer(current, body, botId, deps.dataDir),
    botDeleted(botId: string): void {
      const next = withoutBotMcpServers(deps.cfg().mcpServers, botId);
      if (next) deps.persist(next);
    },
    /** Once at start: servers in one bot's folders become its own (said once), then every server is checked. */
    boot(): void {
      const claimed = claimBotMcpServers(deps.cfg().mcpServers, deps.dataDir);
      if (claimed) {
        deps.persist(claimed.next);
        const bots = deps.bots();
        for (const [botId, names] of Object.entries(claimed.claimed)) {
          const bot = bots.find((candidate) => candidate.id === botId);
          if (bot && bots.length > 1) deps.tell(claimedNotice(bot.name, names), bot);
        }
      }
      health.checkAll();
    },
  };
}

export type McpServersHost = ReturnType<typeof createMcpServersHost>;
