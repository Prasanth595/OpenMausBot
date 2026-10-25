import { describe, expect, it } from "vitest";

import {
  fetchAccount, listInbound, MESSAGE_MAX_CHARS, normalizeNumber, parseInbound, sendWhatsApp, twilioSignature, verifyTwilioSignature,
  whatsappChunks, whatsappLink, whatsappText,
} from "./twilio.ts";

describe("Twilio request signatures", () => {
  // The worked example in https://www.twilio.com/docs/usage/security
  const url = "https://example.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+14158675310", Digits: "1234", From: "+14158675310", To: "+18005551212" };

  it("matches Twilio's documented example", () => {
    expect(twilioSignature(url, params, "12345")).toBe("L/OH5YylLD5NRKLltdqwSvS0BnU=");
    expect(verifyTwilioSignature(url, params, "L/OH5YylLD5NRKLltdqwSvS0BnU=", "12345")).toBe(true);
  });

  it("refuses a changed field, another URL, another token, or no signature", () => {
    const good = "L/OH5YylLD5NRKLltdqwSvS0BnU=";
    expect(verifyTwilioSignature(url, { ...params, Digits: "1235" }, good, "12345")).toBe(false);
    expect(verifyTwilioSignature("https://example.com/other", params, good, "12345")).toBe(false);
    expect(verifyTwilioSignature(url, params, good, "54321")).toBe(false);
    expect(verifyTwilioSignature(url, params, undefined, "12345")).toBe(false);
    expect(verifyTwilioSignature(url, params, good, "")).toBe(false);
  });
});

describe("incoming messages", () => {
  it("normalizes WhatsApp numbers and refuses anything else", () => {
    expect(normalizeNumber("whatsapp:+14155550100")).toBe("+14155550100");
    expect(normalizeNumber("+1 (415) 555-0100")).toBe("+14155550100");
    expect(normalizeNumber("919876543210")).toBe("+919876543210");
    expect(normalizeNumber("hello")).toBe("");
    expect(normalizeNumber("+123")).toBe("");
  });

  it("reads a person's message and ignores status callbacks", () => {
    expect(parseInbound({ From: "whatsapp:+14155550100", To: "whatsapp:+14155238886", Body: " Plan my week ", MessageSid: "SM1", ProfileName: "Azad", NumMedia: "0" }))
      .toEqual({ from: "+14155550100", to: "+14155238886", body: "Plan my week", messageSid: "SM1", profileName: "Azad", numMedia: 0 });
    expect(parseInbound({ From: "whatsapp:+14155550100", MessageSid: "SM2", NumMedia: "1", MediaUrl0: "https://x" })).toMatchObject({ body: "", numMedia: 1 });
    expect(parseInbound({ From: "whatsapp:+14155550100", MessageSid: "SM3", MessageStatus: "delivered" })).toBeNull();
    expect(parseInbound({ Body: "no sender", MessageSid: "SM4" })).toBeNull();
  });
});

describe("WhatsApp text", () => {
  it("turns Markdown into WhatsApp formatting", () => {
    const text = whatsappText([
      "## Plan",
      "This is **important** and *subtle*, ~~old~~ news.",
      "See [the doc](https://example.com/doc).",
      "| Day | Task |",
      "| --- | --- |",
      "| Mon | Review |",
      "```",
      "**not bold in code**",
      "```",
    ].join("\n"));
    expect(text).toBe([
      "*Plan*",
      "This is *important* and _subtle_, ~old~ news.",
      "See the doc (https://example.com/doc).",
      "Day · Task",
      "Mon · Review",
      "```",
      "**not bold in code**",
      "```",
    ].join("\n"));
  });

  it("splits long replies at paragraph boundaries within WhatsApp's limit", () => {
    const para = "word ".repeat(200).trim();
    const chunks = whatsappChunks(`${para}\n\n${para}\n\n${para}`);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MESSAGE_MAX_CHARS);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(`${para} ${para} ${para}`);
    expect(whatsappChunks("short")).toEqual(["short"]);
  });

  it("cuts one paragraph that is longer than a message", () => {
    const chunks = whatsappChunks("x".repeat(MESSAGE_MAX_CHARS * 2 + 10));
    expect(chunks.map((chunk) => chunk.length)).toEqual([MESSAGE_MAX_CHARS, MESSAGE_MAX_CHARS, 10]);
  });
});

describe("sending", () => {
  const creds = { accountSid: "AC" + "0".repeat(32), authToken: "tok", from: "whatsapp:+14155238886" };

  it("posts the message to Twilio with basic auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ sid: "SM9" }), { status: 201 });
    }) as unknown as typeof fetch;
    expect(await sendWhatsApp(creds, "+14155550100", "Hello", { fetchImpl })).toEqual({ ok: true, sid: "SM9" });
    expect(calls[0]!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from(`${creds.accountSid}:tok`).toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]!.init.body)))).toEqual({ To: "whatsapp:+14155550100", From: "whatsapp:+14155238886", Body: "Hello" });
  });

  it("reports Twilio's error and a network failure", async () => {
    const refused = (async () => new Response(JSON.stringify({ code: 21608, message: "Not a sandbox participant" }), { status: 400 })) as unknown as typeof fetch;
    expect(await sendWhatsApp(creds, "+14155550100", "Hi", { fetchImpl: refused })).toEqual({ ok: false, error: "Not a sandbox participant", code: 21608, status: 400 });
    const down = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    expect(await sendWhatsApp(creds, "+14155550100", "Hi", { fetchImpl: down })).toEqual({ ok: false, error: "Could not reach Twilio: ECONNREFUSED" });
  });
});

describe("setup helpers", () => {
  const creds = { accountSid: "AC" + "0".repeat(32), authToken: "tok", from: "whatsapp:+14155238886" };

  it("checks the credentials and names the account", async () => {
    const ok = (async (url: string) => {
      expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}.json`);
      return new Response(JSON.stringify({ friendly_name: "Azad's account" }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchAccount(creds, { fetchImpl: ok })).toEqual({ ok: true, name: "Azad's account" });
    const refused = (async () => new Response(JSON.stringify({ message: "Authenticate" }), { status: 401 })) as unknown as typeof fetch;
    expect(await fetchAccount(creds, { fetchImpl: refused })).toEqual({ ok: false, error: "Twilio didn't accept that Account SID and auth token.", status: 401 });
  });

  it("lists only people's messages after a time, oldest first", async () => {
    const since = Date.parse("2026-10-25T10:00:00Z");
    let asked = "";
    const fetchImpl = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify({ messages: [
        { sid: "SM3", from: "whatsapp:+14155550100", to: "whatsapp:+14155238886", body: "second", direction: "inbound", date_created: "Sat, 25 Oct 2026 10:05:00 +0000", num_media: "0" },
        { sid: "SM2", from: "whatsapp:+14155238886", to: "whatsapp:+14155550100", body: "our reply", direction: "outbound-api", date_created: "Sat, 25 Oct 2026 10:04:00 +0000" },
        { sid: "SM1", from: "whatsapp:+14155550100", to: "whatsapp:+14155238886", body: "first", direction: "inbound", date_created: "Sat, 25 Oct 2026 10:01:00 +0000", num_media: "0" },
        { sid: "SM0", from: "whatsapp:+14155550100", to: "whatsapp:+14155238886", body: "old", direction: "inbound", date_created: "Sat, 25 Oct 2026 09:00:00 +0000" },
      ] }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await listInbound(creds, since, { fetchImpl });
    expect(result.ok && result.messages.map((m) => [m.messageSid, m.body, m.from])).toEqual([["SM1", "first", "+14155550100"], ["SM3", "second", "+14155550100"]]);
    expect(new URL(asked).searchParams.get("To")).toBe("whatsapp:+14155238886");
    expect(new URL(asked).searchParams.get("DateSent>")).toBe("2026-10-25");
  });

  it("opens WhatsApp with the message already typed", () => {
    expect(whatsappLink("whatsapp:+14155238886", "join brave-tiger")).toBe("https://wa.me/14155238886?text=join%20brave-tiger");
  });
});
