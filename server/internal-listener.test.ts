import { request as httpRequest, type IncomingMessage, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createInternalListener, internalListenerRequests } from "./internal-listener.ts";
import { resolveRequestAuth } from "./request-auth.ts";
import { SessionRegistry } from "./sessions.ts";

interface Reply {
  status: number;
  body: { auth: string | null; trust: string | null; error: string } | null;
}

describe("engine-host listener", () => {
  let dir: string;
  let server: Server;
  let port: number;
  let reached: IncomingMessage[];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "omb-internal-listener-"));
    const sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
    reached = [];
    server = createInternalListener((req, res) => {
      reached.push(req);
      const resolved = resolveRequestAuth(req, {
        sessions, cookieName: "omb_session_test", streamPath: "/api/events", url: new URL(req.url ?? "/", "http://x"),
      });
      res.writeHead(resolved.auth ? 200 : resolved.status, { "content-type": "application/json" });
      res.end(JSON.stringify({
        auth: resolved.auth?.kind ?? null,
        trust: resolved.auth?.kind === "loopback" ? (resolved.auth.trust ?? "owner") : null,
        error: resolved.error,
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await closed;
    rmSync(dir, { recursive: true, force: true });
  });

  const call = (path: string, headers: Record<string, string> = {}, method = "GET"): Promise<Reply> =>
    new Promise((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let text = "";
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null }));
      });
      req.on("error", reject);
      req.end();
    });

  it("refuses every route outside /api/internal/ before the handler runs", async () => {
    for (const path of ["/api/bots", "/api/config", "/api/threads/t/messages", "/api/internal", "/api/internal/../bots", "/"]) {
      const response = await call(path, { authorization: "Bearer cap-token" });
      expect(response.status, path).toBe(404);
    }
    expect(reached).toHaveLength(0);
  });

  it("requires a bearer, and refuses a paired session's token", async () => {
    expect((await call("/api/internal/agents")).status).toBe(401);
    expect((await call("/api/internal/agents", { authorization: "Basic abc" })).status).toBe(401);
    expect((await call("/api/internal/agents", { authorization: "Bearer omb_sess_abc" })).status).toBe(401);
    expect(reached).toHaveLength(0);
  });

  it("hands an internal route with a bearer to the handler as service trust, never owner trust", async () => {
    const response = await call("/api/internal/agents", { authorization: "Bearer cap-token" });
    expect(response).toEqual({ status: 200, body: { auth: "loopback", trust: "service", error: "" } });
    expect(internalListenerRequests.has(reached[0]!)).toBe(true);
  });

  it("drops a session cookie that rides along", async () => {
    await call("/api/internal/agents", { authorization: "Bearer cap-token", cookie: "omb_session_test=stolen" });
    expect(reached[0]!.headers.cookie).toBeUndefined();
  });

  it("does not upgrade a connection", async () => {
    const outcome = await new Promise<string>((resolve) => {
      const req = httpRequest({
        host: "127.0.0.1", port, path: "/api/internal/agents",
        headers: { connection: "Upgrade", upgrade: "websocket", authorization: "Bearer cap-token" },
      });
      req.on("upgrade", () => resolve("upgraded"));
      req.on("error", () => resolve("closed"));
      req.on("response", () => resolve("responded"));
      req.end();
    });
    expect(outcome).not.toBe("upgraded");
  });
});
