import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import { requiredScope, serviceAllowed } from "../request-auth.ts";
import { createWhatsAppSettings } from "../whatsapp/settings.ts";
import { createWhatsAppRoutes } from "./whatsapp.ts";
import { dispatchRoutes } from "./table.ts";

const SID = "AC" + "2".repeat(32);
let dir: string;
let server: Server;
let base: string;
let tests: number;

async function serve(webhookBase: string, teamCloud = false) {
  const settings = createWhatsAppSettings(dir);
  const routes = [createWhatsAppRoutes({
    settings,
    channel: { sendTest: async () => { tests += 1; return { ok: true as const }; } },
    webhookBase: () => webhookBase,
    teamCloud,
  })];
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["admin"] }, json, readBody });
    if (!handled) json(res, 404, { from: "next" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const call = async (path: string, method = "GET", body?: unknown) => {
  const response = await fetch(base + path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as any };
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-whatsapp-routes-"));
  tests = 0;
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

describe("WhatsApp settings routes", () => {
  it("saves settings, never returns the token, and keeps it when left empty", async () => {
    await serve("https://bots.example.com");
    expect((await call("/api/whatsapp")).body).toMatchObject({ enabled: false, hasToken: false, webhookUrl: "https://bots.example.com/whatsapp/twilio", reachable: true, available: true });
    const saved = await call("/api/whatsapp", "PUT", { accountSid: SID, authToken: "tok", allowed: ["+1 415 555 0100"], enabled: true });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ enabled: true, hasToken: true, allowed: ["+14155550100"] });
    expect(JSON.stringify(saved.body)).not.toContain("tok\"");
    expect((await call("/api/whatsapp", "PUT", { authToken: "" })).body.hasToken).toBe(true);
    expect((await call("/api/whatsapp/test", "POST")).status).toBe(200);
    expect(tests).toBe(1);
  });

  it("explains bad input and a loopback-only receiver", async () => {
    await serve("http://127.0.0.1:8800");
    expect((await call("/api/whatsapp")).body.reachable).toBe(false);
    const bad = await call("/api/whatsapp", "PUT", { accountSid: "nope" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/starts with AC/);
    expect((await call("/api/whatsapp", "PUT", { enabled: true })).status).toBe(400);
    expect((await call("/api/whatsapp", "PUT", { unknown: 1 })).status).toBe(400);
  });

  it("is off on a team server and leaves other paths alone", async () => {
    await serve("https://bots.example.com", true);
    expect((await call("/api/whatsapp")).body.available).toBe(false);
    expect((await call("/api/whatsapp", "PUT", { enabled: false })).status).toBe(409);
    expect((await call("/api/whatsapp/test", "POST")).status).toBe(409);
    expect((await call("/api/whatsapp/other")).body).toEqual({ from: "next" });
  });

  it("is admin-only and never reachable by service-trust loopback", () => {
    for (const [method, path] of [["GET", "/api/whatsapp"], ["PUT", "/api/whatsapp"], ["POST", "/api/whatsapp/test"]] as const) {
      expect(requiredScope(method, path)).toBe("admin");
      expect(serviceAllowed(method, path)).toBe(false);
    }
  });
});
