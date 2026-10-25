#!/usr/bin/env node
// An ACP agent standing in for one on another machine. On session/new it records the folder and the MCP servers it was given;
// on session/prompt it calls each HTTP server and the harness's front door on the same forwarded port, and records the statuses.
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

if (process.argv.includes("--version")) {
  console.log("fake-remote-acp 1.0.0");
  process.exit(0);
}

const directory = process.env.FAKE_REMOTE_DIR;
if (!directory) throw new Error("FAKE_REMOTE_DIR is required");
mkdirSync(directory, { recursive: true });
const receipt = (value: object) => appendFileSync(join(directory, "receipts.jsonl"), `${JSON.stringify({ pid: process.pid, cwd: process.cwd(), ...value })}\n`);
const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

interface HttpServer { type: "http"; name: string; url: string; headers: Array<{ name: string; value: string }> }
let servers: HttpServer[] = [];

async function status(url: string, init: RequestInit): Promise<number | string> {
  try { return (await fetch(url, { ...init, signal: AbortSignal.timeout(5000) })).status; } catch (error) { return String(error); }
}

for await (const line of createInterface({ input: process.stdin })) {
  let message: { id?: number | string; method?: string; params?: Record<string, unknown> };
  try { message = JSON.parse(line); } catch { continue; }
  if (message.id === undefined || !message.method) continue;
  const { id, method } = message;
  const params = message.params ?? {};
  const respond = (result: unknown) => send({ jsonrpc: "2.0", id, result });
  if (method === "initialize") {
    respond({ protocolVersion: 1, agentInfo: { name: "fake-remote-acp", version: "1.0.0" },
      agentCapabilities: { loadSession: false, mcpCapabilities: { http: true } }, authMethods: [] });
  } else if (method === "session/new") {
    const list = Array.isArray(params.mcpServers) ? params.mcpServers as Array<Record<string, unknown>> : [];
    servers = list.filter((server): server is Record<string, unknown> & HttpServer => server.type === "http");
    receipt({ method, sessionCwd: params.cwd, servers: list.map((server) => ({ name: server.name, type: server.type ?? "stdio", url: server.url })) });
    respond({ sessionId: randomUUID() });
  } else if (method === "session/prompt") {
    const probes = [];
    for (const server of servers) {
      const headers = Object.fromEntries(server.headers.map((header) => [header.name, header.value]));
      probes.push({ name: server.name, status: await status(server.url, { method: "POST",
        headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "1" } } }) }) });
    }
    const base = servers[0] ? new URL(servers[0].url).origin : null;
    const bots = base ? await status(`${base}/api/bots`, {}) : null;
    receipt({ method, probes, botsStatus: bots });
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: params.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "remote-ok" } } } });
    respond({ stopReason: "end_turn" });
  } else {
    respond({});
  }
}
