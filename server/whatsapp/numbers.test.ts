import { describe, expect, it } from "vitest";

import { buyNumber, monthlyPrice, releaseNumber, searchNumbers, setSmsWebhook } from "./numbers.ts";

const creds = { accountSid: "AC" + "5".repeat(32), authToken: "tok" };
const ACCOUNT = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}`;

function stub(respond: (url: string, init: RequestInit) => { status?: number; body?: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const { status = 200, body = {} } = respond(url, init);
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("finding a number", () => {
  it("lists toll-free numbers that can both text and take calls", async () => {
    const { calls, fetchImpl } = stub(() => ({ body: { available_phone_numbers: [
      { phone_number: "+18445550100", friendly_name: "(844) 555-0100", capabilities: { SMS: true, voice: true, MMS: true } },
      { phone_number: "+18445550101", friendly_name: "(844) 555-0101", capabilities: { SMS: false, voice: true } },
    ] } }));
    expect(await searchNumbers(creds, "US", "toll-free", { fetchImpl })).toEqual({
      ok: true, numbers: [{ phoneNumber: "+18445550100", friendlyName: "(844) 555-0100", sms: true, voice: true }],
    });
    const asked = new URL(calls[0]!.url);
    expect(asked.pathname).toBe(`/2010-04-01/Accounts/${creds.accountSid}/AvailablePhoneNumbers/US/TollFree.json`);
    expect(asked.searchParams.get("SmsEnabled")).toBe("true");
    expect(asked.searchParams.get("VoiceEnabled")).toBe("true");
  });

  it("reads the monthly price for the kind of number", async () => {
    const { calls, fetchImpl } = stub(() => ({ body: { price_unit: "usd", phone_number_prices: [
      { number_type: "local", base_price: "1.15", current_price: "1.15" },
      { number_type: "toll free", base_price: "2.15", current_price: "2.15" },
    ] } }));
    expect(await monthlyPrice(creds, "US", "toll-free", { fetchImpl })).toEqual({ ok: true, amount: "2.15", currency: "USD" });
    expect(calls[0]!.url).toBe("https://pricing.twilio.com/v1/PhoneNumbers/Countries/US");
    expect(await monthlyPrice(creds, "US", "local", { fetchImpl })).toMatchObject({ amount: "1.15" });
    const none = stub(() => ({ body: { phone_number_prices: [] } }));
    expect(await monthlyPrice(creds, "GB", "toll-free", { fetchImpl: none.fetchImpl })).toEqual({ ok: false, error: "Twilio has no toll free number price for GB." });
  });
});

describe("owning a number", () => {
  it("buys the number named MausBot, pointing texts at the webhook when there is one", async () => {
    const { calls, fetchImpl } = stub(() => ({ status: 201, body: { sid: "PN1", phone_number: "+18445550100" } }));
    expect(await buyNumber(creds, "+18445550100", "https://bots.example.com/whatsapp/twilio", { fetchImpl })).toEqual({
      ok: true, number: { sid: "PN1", phoneNumber: "+18445550100" },
    });
    expect(calls[0]!.url).toBe(`${ACCOUNT}/IncomingPhoneNumbers.json`);
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]!.init.body)))).toEqual({
      PhoneNumber: "+18445550100", FriendlyName: "MausBot", SmsUrl: "https://bots.example.com/whatsapp/twilio", SmsMethod: "POST",
    });
    await buyNumber(creds, "+18445550100", null, { fetchImpl });
    expect(new URLSearchParams(String(calls[1]!.init.body)).has("SmsUrl")).toBe(false);
  });

  it("reports Twilio's refusal to buy", async () => {
    const { fetchImpl } = stub(() => ({ status: 400, body: { message: "Insufficient funds" } }));
    expect(await buyNumber(creds, "+18445550100", null, { fetchImpl })).toEqual({ ok: false, error: "Insufficient funds", status: 400 });
  });

  it("changes where texts go and releases the number, treating an already-gone number as released", async () => {
    const { calls, fetchImpl } = stub((_url, init) => (init.method === "DELETE" ? { status: 204 } : { body: { sid: "PN1" } }));
    expect(await setSmsWebhook(creds, "PN1", null, { fetchImpl })).toEqual({ ok: true });
    expect(new URLSearchParams(String(calls[0]!.init.body)).get("SmsUrl")).toBe("");
    expect(await releaseNumber(creds, "PN1", { fetchImpl })).toEqual({ ok: true });
    expect(calls[1]).toMatchObject({ url: `${ACCOUNT}/IncomingPhoneNumbers/PN1.json`, init: { method: "DELETE" } });
    const gone = stub(() => ({ status: 404, body: { message: "not found" } }));
    expect(await releaseNumber(creds, "PN1", { fetchImpl: gone.fetchImpl })).toEqual({ ok: true });
  });
});
