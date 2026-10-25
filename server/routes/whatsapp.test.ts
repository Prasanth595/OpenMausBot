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
let verifyOk: boolean;

async function serve(webhookBase: string, teamCloud = false) {
  const settings = createWhatsAppSettings(dir);
  const routes = [createWhatsAppRoutes({
    settings,
    channel: {
      sendTest: async () => { tests += 1; return { ok: true as const }; },
      verify: async (candidate: { accountSid?: string; authToken?: string } = {}) => {
        if (!verifyOk) return { ok: false as const, error: "Twilio didn't accept that Account SID and auth token." };
        settings.update(candidate);
        settings.setAccountName("Azad", Date.now());
        return { ok: true as const, name: "Azad" };
      },
      startLink: () => ({ ...settings.startLink(Date.now()), linkUrl: "https://wa.me/14155238886?text=link%20123456" }),
      mode: () => (webhookBase.startsWith("https") ? "instant" as const : "polling" as const),
    },
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
  verifyOk = true;
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

  it("checks the Twilio account, then hands out a link code once and shows only that one is waiting", async () => {
    await serve("http://127.0.0.1:8800");
    expect((await call("/api/whatsapp/link", "POST")).status).toBe(409);
    verifyOk = false;
    const refused = await call("/api/whatsapp/verify", "POST", { accountSid: SID, authToken: "bad" });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatch(/didn't accept/);
    verifyOk = true;
    const checked = await call("/api/whatsapp/verify", "POST", { accountSid: SID, authToken: "tok" });
    expect(checked.status).toBe(200);
    expect(checked.body).toMatchObject({ accountName: "Azad", hasToken: true, mode: "polling", sandbox: true });
    expect((await call("/api/whatsapp", "PUT", { joinPhrase: "Join Brave-Tiger" })).body.joinUrl).toBe("https://wa.me/14155238886?text=join%20brave-tiger");
    expect((await call("/api/whatsapp", "PUT", { joinPhrase: "hello" })).status).toBe(400);
    const link = await call("/api/whatsapp/link", "POST");
    expect(link.body.code).toMatch(/^\d{6}$/);
    expect(link.body.linkExpiresAt).toBeGreaterThan(Date.now());
    const after = await call("/api/whatsapp");
    expect(after.body.code).toBeUndefined();
    expect(JSON.stringify(after.body)).not.toContain(link.body.code);
  });

  it("masks linked numbers", async () => {
    await serve("https://bots.example.com");
    await call("/api/whatsapp", "PUT", { allowed: ["+14155550100"] });
    expect((await call("/api/whatsapp")).body.linked).toEqual(["+1 415 ••• 0100"]);
  });

  it("is admin-only and never reachable by service-trust loopback", () => {
    for (const [method, path] of [["GET", "/api/whatsapp"], ["PUT", "/api/whatsapp"], ["POST", "/api/whatsapp/test"], ["POST", "/api/whatsapp/verify"], ["POST", "/api/whatsapp/link"]] as const) {
      expect(requiredScope(method, path)).toBe("admin");
      expect(serviceAllowed(method, path)).toBe(false);
    }
  });
});
