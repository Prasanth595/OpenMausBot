// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ calls: [] as Array<{ path: string; body?: any }> }));
vi.mock("@/state/store", async (actual) => ({
  ...(await actual<typeof import("@/state/store")>()),
  api: async (path: string, init?: RequestInit) => {
    server.calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path.startsWith("/api/whatsapp/numbers")) {
      return { numbers: [{ phoneNumber: "+18445550100", friendlyName: "(844) 555-0100" }, { phoneNumber: "+18445550101", friendlyName: "(844) 555-0101" }], price: { amount: "2.15", currency: "USD" } };
    }
    return { ok: true };
  },
}));

const { MausBotNumberSection } = await import("./MausBotNumberSection");

let root: Root;
let host: HTMLElement;
const onStatus = vi.fn();
const settle = () => new Promise((done) => setTimeout(done, 0));
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;

beforeEach(() => {
  server.calls = [];
  onStatus.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

describe("MausBot's own number", () => {
  it("shows the monthly price before buying and buys only after a second, explicit click", async () => {
    flushSync(() => root.render(createElement(MausBotNumberSection, { onStatus })));
    flushSync(() => button("Find numbers").click());
    await settle();
    expect(server.calls[0]!.path).toBe("/api/whatsapp/numbers?country=US&kind=toll-free");
    expect(host.textContent).toContain("carriers only deliver business texts from a registered number");
    flushSync(() => button("Buy for 2.15 USD a month").click());
    expect(server.calls).toHaveLength(1);
    flushSync(() => host.querySelectorAll<HTMLInputElement>("input[type='radio']")[1]!.click());
    flushSync(() => button("Buy for 2.15 USD a month").click());
    flushSync(() => button("Confirm: buy +18445550101 for 2.15 USD a month").click());
    await settle();
    expect(server.calls.at(-1)).toEqual({
      path: "/api/whatsapp/number",
      body: { phoneNumber: "+18445550101", country: "US", kind: "toll-free", confirmedAmount: "2.15", confirm: true },
    });
    expect(onStatus).toHaveBeenCalled();
  });

  it("shows the owned number and releases it only after confirming", async () => {
    flushSync(() => root.render(createElement(MausBotNumberSection, { onStatus, number: { sid: "PN1", phoneNumber: "+18445550100", country: "US", kind: "toll-free", price: { amount: "2.15", currency: "USD" } } })));
    expect(host.textContent).toContain("MausBot's number: +18445550100");
    expect(host.textContent).toContain("Twilio bills 2.15 USD a month for it.");
    flushSync(() => button("Release this number").click());
    expect(server.calls).toEqual([]);
    flushSync(() => button("Release it").click());
    await settle();
    expect(server.calls).toEqual([{ path: "/api/whatsapp/number/release", body: { confirm: true } }]);
  });
});
