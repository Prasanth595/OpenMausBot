// A URL MCP server's secret headers stay with the broker: the turn's server list points the engine at
// `http://127.0.0.1:<broker>/b/<token>/mcp-<name>` with no headers, and the broker adds them for the server's real
// address. The token is bound to the conversation and reused for its later turns while the servers are the same, so a
// long-lived engine process keeps its MCP sessions (the driver's launch key stays the same); it slides with each turn
// and ends at its TTL, or when the servers change.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { onConfigSaved } from "../config.ts";
import type { McpServerSpec } from "../contracts.ts";
import { botBox, type BoxBroker } from "./box.ts";
import { brokerUrl } from "./broker.ts";

export interface BrokerTurn { botId: string; threadId: string; configRevision?: number }

const NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/i;
const MAX_REMEMBERED = 10_000;
/** The live token per conversation and the servers it was minted for. */
const remembered = new Map<string, { token: string; fingerprint: string; grant: string; names: string[]; broker: BoxBroker }>();
let configRevision = 0;

export function mcpConfigRevision(): number { return configRevision; }

function revokeRemembered(key: string): void {
  const known = remembered.get(key);
  if (known) known.broker.revoke(known.token);
  remembered.delete(key);
}

onConfigSaved((before, after) => {
  const previous = before.mcpServers as Record<string, unknown> | undefined;
  const current = after.mcpServers as Record<string, unknown> | undefined;
  if (!isDeepStrictEqual(previous, current)) configRevision += 1;
  for (const [key, known] of remembered) {
    if (known.names.some((name) => !isDeepStrictEqual(previous?.[name], current?.[name]))) revokeRemembered(key);
  }
});

/** The grant name for a server: one URL server per name per conversation. */
export function mcpGrantName(name: string): string {
  return `mcp-${name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 48)}`;
}

/** Test seam: forget every remembered token. */
export function forgetBrokeredMcp(): void { remembered.clear(); }

/** The turn's custom servers with every URL server's headers moved to the broker; unchanged when the broker is off. */
export function brokerRemoteMcp(custom: Record<string, McpServerSpec>, turn: BrokerTurn, broker: BoxBroker | null = botBox.broker()): Record<string, McpServerSpec> {
  if (!broker) return custom;
  if (turn.configRevision !== undefined && turn.configRevision !== configRevision) {
    throw new Error("MCP configuration changed while preparing this turn. Retry the message.");
  }
  const out: Record<string, McpServerSpec> = {};
  const grants: Record<string, { upstream: string; headers: Record<string, string> }> = {};
  const brokered: string[] = [];
  for (const [name, server] of Object.entries(custom)) {
    if (!("url" in server) || typeof server.url !== "string" || !NAME.test(name)) { out[name] = server; continue; }
    grants[mcpGrantName(name)] = { upstream: server.url, headers: { ...server.headers } };
    brokered.push(name);
  }
  const key = `${turn.botId}\u0000${turn.threadId}`;
  if (!brokered.length) { revokeRemembered(key); return custom; }
  const fingerprint = createHash("sha256").update(JSON.stringify(Object.entries(grants).sort(([a], [b]) => (a < b ? -1 : 1)))).digest("hex");
  const known = remembered.get(key);
  let token = known && known.fingerprint === fingerprint && broker.lookup(known.token, known.grant).ok ? known.token : null;
  if (!token) {
    revokeRemembered(key);
    token = broker.mintForThread({ botId: turn.botId, threadId: turn.threadId, grants }).token;
    remembered.set(key, { token, fingerprint, grant: mcpGrantName(brokered[0]!), names: brokered, broker });
    if (remembered.size > MAX_REMEMBERED) revokeRemembered(remembered.keys().next().value!);
  } else broker.touchThread(turn.threadId, token);
  for (const name of brokered) {
    const server = custom[name] as McpServerSpec & { url: string; type?: string };
    out[name] = { ...server, url: brokerUrl(broker.port, token, mcpGrantName(name)), headers: {} } as McpServerSpec;
  }
  return out;
}
