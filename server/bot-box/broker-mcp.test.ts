import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer, request } from "node:http";
import { connect, createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { saveConfig } from "../config.ts";
import type { McpServerSpec, RemoteMcpSpec } from "../contracts.ts";
import { attachCustomMcp } from "../mcp-result-budget.ts";
import { RemoteMcpClient } from "../mcp-http.ts";
import { probeMcpServer } from "../mcp-probe.ts";
import { startFakeHttpMcp } from "../testing/fake-http-mcp-server.ts";
import { botBox, BOX_BROKER_PORT, type BoxBroker } from "./box.ts";
import { brokerRemoteMcp, forgetBrokeredMcp, mcpGrantName } from "./broker-mcp.ts";
import { openCredentialBroker, type CredentialBroker } from "./broker.ts";

const custom = {
  notion: { type: "http" as const, url: "https://mcp.notion.example/mcp", headers: { authorization: "Bearer notion-secret" } },
  files: { command: "npx", args: ["files-mcp"], env: { FILES_TOKEN: "stdio-secret" } },
};

describe("remote MCP servers through the broker", () => {
  let dir: string, credentials: CredentialBroker;
  afterEach(async () => { vi.restoreAllMocks(); await credentials?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); forgetBrokeredMcp(); });
  // The broker listens on a unix socket, which Windows refuses at a file path; the box runs only on a Linux Cloud home
  // (detect.ts says "not-linux" anywhere else), so Windows gets "off" below.
  const withBroker = it.skipIf(process.platform === "win32");
  const broker = async (now?: () => number): Promise<BoxBroker> => {
    dir = mkdtempSync(join(tmpdir(), "omb-bmcp-"));
    credentials = await openCredentialBroker({ socketPath: join(dir, "b.sock"), now });
    return { port: BOX_BROKER_PORT, mintForThread: credentials.mintForThread, touchThread: credentials.touchThread, revoke: credentials.revoke, revokeThread: credentials.revokeThread, lookup: credentials.lookup };
  };

  const call = (url: string) => new Promise<number>((resolve, reject) => {
    const req = request({ socketPath: credentials.socketPath, path: new URL(url).pathname }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end();
  });

  withBroker.each(["headers", "url", "removed", "stdio", "empty"])("revokes the old grant when the turn's MCP configuration is %s", async (change) => {
    let clock = 1_800_000_000_000;
    const b = await broker(() => clock);
    const upstream = createHttpServer((req, res) => { res.writeHead(req.headers.authorization === "Bearer notion-secret" ? 200 : 403).end(); });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    try {
      const servers = { ...custom, notion: { ...custom.notion, url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/mcp` } };
      const turn = { botId: "b1", threadId: "t1" };
      const first = (brokerRemoteMcp(servers, turn, b).notion as RemoteMcpSpec).url;
      const other = (brokerRemoteMcp(servers, { ...turn, threadId: "t2" }, b).notion as RemoteMcpSpec).url;
      expect(await call(first)).toBe(200);
      const changed: Record<string, McpServerSpec> = change === "empty" ? {} : change === "removed" ? { files: custom.files }
        : { ...servers, notion: change === "stdio" ? custom.files : { ...servers.notion, ...(change === "url" ? { url: `${servers.notion.url}-new` } : { headers: { authorization: "Bearer rotated" } }) } };
      brokerRemoteMcp(changed, turn, b);
      const statusAtChange = await call(first);
      expect(await call(other)).toBe(200);
      clock += 13 * 60 * 60_000;
      brokerRemoteMcp(changed, turn, b);
      clock += 12 * 60 * 60_000;
      brokerRemoteMcp(changed, turn, b);
      expect(await call(first)).toBe(401);
      expect(statusAtChange).toBe(401);
    } finally {
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  withBroker.each(["headers", "url", "disabled", "removed", "empty"])("revokes affected conversations immediately when saved MCP configuration is %s", async (change) => {
    const b = await broker();
    const turn = { botId: "b1", threadId: "t1" };
    const notion = { ...custom.notion, enabled: true };
    saveConfig({ mcpServers: { notion, files: custom.files } });
    const first = (brokerRemoteMcp(custom, turn, b).notion as RemoteMcpSpec).url;
    const token = new URL(first).pathname.split("/")[2]!;
    expect(credentials.lookup(token, "mcp-notion").ok).toBe(true);
    const other = (brokerRemoteMcp({ docs: custom.notion }, { ...turn, threadId: "t2" }, b).docs as RemoteMcpSpec).url;
    const next = change === "empty" ? {} : change === "removed" ? { files: custom.files }
      : { notion: { ...notion, ...(change === "url" ? { url: "https://new.example/mcp" } : change === "disabled" ? { enabled: false } : { headers: { authorization: "Bearer rotated" } }) }, files: custom.files };
    saveConfig({ mcpServers: next });
    expect(credentials.lookup(token, "mcp-notion").ok).toBe(false);
    expect(credentials.lookup(new URL(other).pathname.split("/")[2]!, "mcp-docs").ok).toBe(true);
  });

  withBroker("reconciles an empty server list through the turn integration caller", async () => {
    const b = await broker();
    vi.spyOn(botBox, "broker").mockReturnValue(b);
    const turn = { botId: "b1", threadId: "t1" };
    const first = (brokerRemoteMcp(custom, turn, b).notion as RemoteMcpSpec).url;
    const integrations = {};
    attachCustomMcp(integrations, {}, {}, turn);
    expect(integrations).toEqual({});
    expect(credentials.lookup(new URL(first).pathname.split("/")[2]!, "mcp-notion").ok).toBe(false);
  });

  withBroker("moves a URL server's headers to the broker and leaves stdio servers alone", async () => {
    const out = brokerRemoteMcp(custom, { botId: "b1", threadId: "t1" }, await broker());
    expect(out.files).toEqual(custom.files);
    const notion = out.notion as { type: string; url: string; headers: Record<string, string> };
    expect(notion.type).toBe("http");
    expect(notion.headers).toEqual({});
    const match = /^http:\/\/127\.0\.0\.1:18080\/b\/(omb_t0_[a-f0-9]{48})\/mcp-notion$/.exec(notion.url);
    expect(match).not.toBeNull();
    expect(JSON.stringify(out)).not.toContain("notion-secret");
    expect(credentials.lookup(match![1]!, "mcp-notion")).toMatchObject({ ok: true, botId: "b1", threadId: "t1", grant: { upstream: "https://mcp.notion.example/mcp", headers: { authorization: "Bearer notion-secret" } } });
    expect(credentials.lookup(match![1]!, "mcp-files").ok).toBe(false);
  });

  withBroker("the same conversation keeps its token across turns; another conversation or changed headers get a new one", async () => {
    const b = await broker();
    const url = (servers: Record<string, unknown>) => (servers.notion as { url: string }).url;
    const first = url(brokerRemoteMcp(custom, { botId: "b1", threadId: "t1" }, b));
    expect(url(brokerRemoteMcp(custom, { botId: "b1", threadId: "t1" }, b))).toBe(first);
    expect(url(brokerRemoteMcp(custom, { botId: "b1", threadId: "t2" }, b))).not.toBe(first);
    const changed = { ...custom, notion: { ...custom.notion, headers: { authorization: "Bearer rotated" } } };
    expect(url(brokerRemoteMcp(changed, { botId: "b1", threadId: "t1" }, b))).not.toBe(first);
    credentials.revokeThread("t1");
    expect(url(brokerRemoteMcp(changed, { botId: "b1", threadId: "t1" }, b))).not.toBe(first);
    expect(credentials.stats().tokens).toBe(2);
  });

  withBroker("takes a gateway's two service-token headers to it, while the engine's server list holds neither", async () => {
    const id = "id-5c1d.access", secret = "secret-0f9e8d7c6b5a";
    const gateway = await startFakeHttpMcp({ tools: [{ name: "lookup_order" }], requireHeaders: { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret } });
    const b = await broker();
    // In a box the broker's port is a loopback bridge to its socket; a TCP listener stands in for that bridge here.
    const bridge = createServer((socket) => {
      const upstream = connect(credentials.socketPath);
      socket.pipe(upstream).pipe(socket);
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
    });
    await new Promise<void>((resolve) => bridge.listen(0, "127.0.0.1", resolve));
    try {
      const custom = { orders: { type: "http" as const, url: gateway.url, headers: { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret } } };
      const out = brokerRemoteMcp(custom, { botId: "b1", threadId: "t1" }, { ...b, port: (bridge.address() as AddressInfo).port });
      const orders = out.orders as RemoteMcpSpec;
      expect(orders.headers).toEqual({});
      expect(JSON.stringify(out)).not.toContain(id);
      expect(JSON.stringify(out)).not.toContain(secret);

      expect(await probeMcpServer({ ...custom.orders, headers: {}, enabled: true })).toMatchObject({ ok: false, reason: "keys", status: 403 });
      expect(await probeMcpServer({ ...orders, enabled: true })).toMatchObject({ ok: true, tools: [{ name: "lookup_order" }] });
      const client = new RemoteMcpClient({ ...orders, headers: { "CF-Access-Client-Secret": "the engine's own guess" } });
      const signal = AbortSignal.timeout(10_000);
      await client.initialize("engine", signal);
      expect(await client.request("tools/call", { name: "lookup_order", arguments: { id: "1042" } }, signal)).toEqual({ content: [{ type: "text", text: "remote execution recorded" }] });
      await client.close();
      expect(gateway.calls).toEqual([{ name: "lookup_order", arguments: { id: "1042" } }]);
      expect(gateway.seenHeaders.filter((headers) => headers["cf-access-client-id"] === id && headers["cf-access-client-secret"] === secret).length).toBeGreaterThanOrEqual(3);
    } finally {
      await new Promise((resolve) => bridge.close(resolve));
      await gateway.close();
    }
  });

  it("off: the servers come back untouched", () => {
    expect(brokerRemoteMcp(custom, { botId: "b1", threadId: "t1" }, null)).toBe(custom);
    expect(mcpGrantName("My Server!")).toBe("mcp-my-server-");
  });
});
