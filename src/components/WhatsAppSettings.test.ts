// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WhatsAppStatus } from "./WhatsAppSettings";

const server = vi.hoisted(() => ({ calls: [] as Array<{ path: string; init?: RequestInit }>, status: null as unknown as WhatsAppStatus, fail: "" }));
vi.mock("@/state/store", async (actual) => ({
  ...(await actual<typeof import("@/state/store")>()),
  api: async (path: string, init?: RequestInit) => {
    server.calls.push({ path, init });
    if (server.fail && init?.method) throw new Error(server.fail);
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      server.status = { ...server.status, ...body, hasToken: server.status.hasToken || Boolean(body.authToken), from: `whatsapp:${body.from}` };
      delete (server.status as unknown as Record<string, unknown>).authToken;
    }
    return server.status;
  },
}));

const { WhatsAppSettings } = await import("./WhatsAppSettings");

let root: Root;
let host: HTMLElement;
const base: WhatsAppStatus = {
  enabled: false, accountSid: "", hasToken: false, from: "whatsapp:+14155238886", allowed: [],
  webhookUrl: "http://127.0.0.1:8800/whatsapp/twilio", reachable: false, available: true,
};
const settle = () => new Promise((done) => setTimeout(done, 0));
const input = (label: string) => [...host.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))!.querySelector("input")!;
const type = (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;

beforeEach(async () => {
  server.calls = [];
  server.status = { ...base };
  server.fail = "";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root.render(createElement(WhatsAppSettings)));
  await settle();
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

describe("WhatsApp settings", () => {
  it("shows the webhook URL, warns that this computer is not reachable, and explains routing", () => {
    expect(host.textContent).toContain("http://127.0.0.1:8800/whatsapp/twilio");
    expect(host.textContent).toContain("Twilio can't reach this computer");
    expect(host.textContent).toContain("Access → Additional departments");
    expect(button("Send test message").disabled).toBe(true);
  });

  it("saves the credentials and never shows the token again", async () => {
    flushSync(() => {
      type(input("Twilio Account SID"), "AC" + "4".repeat(32));
      type(input("Twilio auth token"), "tok");
      type(input("Your WhatsApp number"), "+14155550100, +919876543210");
    });
    flushSync(() => button("Save").click());
    await settle();
    const put = server.calls.find((call) => call.init?.method === "PUT")!;
    expect(JSON.parse(String(put.init!.body))).toEqual({
      accountSid: "AC" + "4".repeat(32), authToken: "tok", from: "+14155238886", allowed: ["+14155550100", "+919876543210"], enabled: false,
    });
    expect(input("Twilio auth token").value).toBe("");
    expect(input("Twilio auth token").placeholder).toContain("Saved");
    expect(host.textContent).toContain("WhatsApp settings saved.");
    expect(button("Send test message").disabled).toBe(false);
  });

  it("shows the server's reason when saving fails", async () => {
    server.fail = "Add the Account SID, the auth token and your WhatsApp number before switching WhatsApp on";
    flushSync(() => host.querySelector<HTMLButtonElement>("[role='switch']")!.click());
    await settle();
    expect(host.querySelector("[role='alert']")?.textContent).toContain("before switching WhatsApp on");
  });

  it("says WhatsApp is not available on a team server", async () => {
    flushSync(() => root.unmount());
    root = createRoot(host);
    server.status = { ...base, available: false };
    flushSync(() => root.render(createElement(WhatsAppSettings)));
    await settle();
    expect(host.textContent).toContain("isn't available on a team server");
    expect(host.querySelector("input")).toBeNull();
  });
});
