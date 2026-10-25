// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WhatsAppStatus } from "./WhatsAppSettings";

const server = vi.hoisted(() => ({ calls: [] as Array<{ path: string; body?: any }>, status: null as unknown as WhatsAppStatus, fail: "" }));
vi.mock("@/state/store", async (actual) => ({
  ...(await actual<typeof import("@/state/store")>()),
  api: async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    server.calls.push({ path, body });
    if (server.fail && init?.method) throw new Error(server.fail);
    if (path === "/api/whatsapp/verify") server.status = { ...server.status, accountSid: body.accountSid, hasToken: true, accountName: "Azad" };
    if (path === "/api/whatsapp" && init?.method === "PUT" && body.joinPhrase) {
      server.status = { ...server.status, joinPhrase: body.joinPhrase, joinUrl: `https://wa.me/14155238886?text=${encodeURIComponent(body.joinPhrase)}` };
    }
    if (path === "/api/whatsapp/link") {
      server.status = { ...server.status, linkExpiresAt: Date.now() + 600_000 };
      return { ...server.status, code: "482913", linkUrl: "https://wa.me/14155238886?text=link%20482913" };
    }
    return server.status;
  },
}));

const { WhatsAppSettings } = await import("./WhatsAppSettings");

let root: Root;
let host: HTMLElement;
const base: WhatsAppStatus = {
  enabled: false, accountSid: "", hasToken: false, from: "whatsapp:+14155238886", allowed: [], linked: [], sandbox: true, mode: "polling",
  webhookUrl: "http://127.0.0.1:8800/whatsapp/twilio", reachable: false, available: true,
};
const settle = () => new Promise((done) => setTimeout(done, 0));
const input = (label: string) => [...host.querySelectorAll("label")].find((l) => l.textContent?.startsWith(label))!.querySelector("input")!;
const type = (el: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
const step = (n: number) => host.querySelector(`[data-whatsapp-step='${n}']`)!;

async function mount(status: WhatsAppStatus) {
  server.status = status;
  flushSync(() => root.render(createElement(WhatsAppSettings)));
  await settle();
}

beforeEach(() => {
  server.calls = [];
  server.fail = "";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

describe("WhatsApp guided setup", () => {
  it("walks through connecting Twilio, joining the sandbox and linking the phone", async () => {
    await mount({ ...base });
    expect(step(1).textContent).toContain("Create a free account");
    flushSync(() => {
      type(input("Twilio Account SID"), "AC" + "4".repeat(32));
      type(input("Twilio auth token"), "tok");
    });
    flushSync(() => button("Check").click());
    await settle();
    expect(server.calls.at(-1)).toEqual({ path: "/api/whatsapp/verify", body: { accountSid: "AC" + "4".repeat(32), authToken: "tok" } });
    expect(step(1).textContent).toContain("Connected to Azad");

    flushSync(() => type(host.querySelector<HTMLInputElement>("[aria-label='Sandbox join phrase']")!, "join brave-tiger"));
    flushSync(() => step(2).querySelector<HTMLButtonElement>("button[type='submit']")!.click());
    await settle();
    const open = [...step(2).querySelectorAll("a")].find((a) => a.textContent?.includes("Open WhatsApp"))!;
    expect(open.getAttribute("href")).toBe("https://wa.me/14155238886?text=join%20brave-tiger");
    expect(step(2).querySelector("svg")).not.toBeNull();
    flushSync(() => button("I've sent it").click());

    flushSync(() => button("Link my phone").click());
    await settle();
    expect(step(3).textContent).toContain("Or send \"link 482913\" to +14155238886 on WhatsApp.");
    expect(step(3).textContent).toContain("Waiting for your message");
  });

  it("shows WhatsApp on, who is linked and how it hears messages", async () => {
    await mount({ ...base, enabled: true, accountSid: "AC1", hasToken: true, accountName: "Azad", allowed: ["+14155550100"], linked: ["+1 415 ••• 0100"] });
    expect(host.textContent).toContain("WhatsApp is on. Message MausBot at +14155238886.");
    expect(host.textContent).toContain("Linked: +1 415 ••• 0100");
    expect(host.textContent).toContain("checks for messages every few seconds");
    expect(host.querySelector("[role='switch']")?.getAttribute("aria-checked")).toBe("true");
  });

  it("switches off with only that change, and a test message keeps what is being typed", async () => {
    await mount({ ...base, enabled: true, accountSid: "AC1", hasToken: true, accountName: "Azad", allowed: ["+14155550100"], linked: ["+1 415 ••• 0100"] });
    flushSync(() => type(input("Your WhatsApp number"), "+1 415 555 0199"));
    flushSync(() => button("Send test message").click());
    await settle();
    expect(input("Your WhatsApp number").value).toBe("+1 415 555 0199");
    flushSync(() => host.querySelector<HTMLButtonElement>("[role='switch']")!.click());
    await settle();
    expect(server.calls.at(-1)).toEqual({ path: "/api/whatsapp", body: { enabled: false } });
  });

  it("keeps the raw fields and the webhook URL under Advanced", async () => {
    await mount({ ...base });
    const advanced = host.querySelector("details")!;
    expect(advanced.textContent).toContain("WhatsApp sender number");
    expect(advanced.textContent).toContain("http://127.0.0.1:8800/whatsapp/twilio");
    expect(advanced.textContent).toContain("checks Twilio for new messages every few seconds");
  });

  it("shows Twilio's refusal in plain words", async () => {
    await mount({ ...base });
    server.fail = "Twilio didn't accept that Account SID and auth token.";
    flushSync(() => {
      type(input("Twilio Account SID"), "AC" + "4".repeat(32));
      type(input("Twilio auth token"), "bad");
    });
    flushSync(() => button("Check").click());
    await settle();
    expect(host.querySelector("[role='alert']")?.textContent).toContain("didn't accept");
  });

  it("says WhatsApp is not available on a team server", async () => {
    await mount({ ...base, available: false });
    expect(host.textContent).toContain("isn't available on a team server");
    expect(host.querySelector("input")).toBeNull();
  });
});
