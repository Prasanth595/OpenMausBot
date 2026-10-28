import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "../store.ts";
import { createWhatsAppChannel, isPublicHttps, POLL_BACKOFF_MS, POLL_MS, WHATSAPP_PATH, WHATSAPP_PROMPT } from "./channel.ts";
import { createWhatsAppSettings, type WhatsAppSettings } from "./settings.ts";
import { SESSION_WINDOW_MS, twilioSignature } from "./twilio.ts";

const SID = "AC" + "1".repeat(32);
const TOKEN = "secret-token";
const ME = "+14155550100";

let dir: string;
let settings: WhatsAppSettings;
let server: Server;
let base: string;
let clock: number;
let delivered: Array<{ botId: string; threadId: string; text: string; sendId: string }>;
let sent: Array<{ to: string; body: string }>;
let paths: Map<string, Message[]>;
let threads: string[];
let twilioFails: boolean;
let teamCloud: boolean;
let reachable: boolean;
let inbox: Array<Record<string, string>>;
let listFails: boolean;
let listGate: Promise<void> | null;
let endlessPages: boolean;
let lists = 0;
let claimRefused: boolean;
let released: number;
let channel: ReturnType<typeof createWhatsAppChannel>;

const msg = (id: string, role: "user" | "bot", text: string, extra: Partial<Message> = {}): Message =>
  ({ id, role, kind: "text", text, at: 0, ...extra }) as Message;

function makeChannel() {
  return createWhatsAppChannel({
    settings,
    teamCloud,
    defaultBot: () => ({ id: "maus", name: "MausBot" }),
    threadExists: (_botId, threadId) => threads.includes(threadId),
    createThread: () => {
      const id = `t${threads.length + 1}`;
      threads.push(id);
      paths.set(id, []);
      return id;
    },
    deliver: async (botId, threadId, text, sendId) => {
      delivered.push({ botId, threadId, text, sendId });
      paths.get(threadId)!.push(msg(sendId, "user", text));
    },
    activePath: (threadId) => paths.get(threadId) ?? [],
    needsInput: (message) => Boolean(message.card?.requestId),
    reachable: () => reachable,
    fetchImpl: (async (url: string, init: RequestInit = {}) => {
      if (url.endsWith(".json") && url.includes("/Accounts/") && !url.includes("/Messages")) {
        const token = Buffer.from(String((init.headers as Record<string, string>).authorization).replace("Basic ", ""), "base64").toString().split(":")[1];
        return token === "bad" ? new Response("{}", { status: 401 }) : new Response(JSON.stringify({ friendly_name: "Azad" }), { status: 200 });
      }
      if (!init.method) {
        lists += 1;
        if (listGate) await listGate;
        if (listFails) return new Response(JSON.stringify({ message: "Service unavailable" }), { status: 503 });
        return new Response(JSON.stringify({ messages: inbox, ...(endlessPages ? { next_page_uri: "/2010-04-01/x/Messages.json?Page=n" } : {}) }), { status: 200 });
      }
      const form = new URLSearchParams(String(init.body));
      if (twilioFails) return new Response(JSON.stringify({ code: 21608, message: "Not a sandbox participant" }), { status: 400 });
      sent.push({ to: form.get("To")!, body: form.get("Body")! });
      return new Response(JSON.stringify({ sid: `SM${sent.length}` }), { status: 201 });
    }) as unknown as typeof fetch,
    now: () => clock,
  });
}

async function post(fields: Record<string, string>, signature?: string): Promise<number> {
  const url = `${base}${WHATSAPP_PATH}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature ?? twilioSignature(url, fields, TOKEN) },
    body: new URLSearchParams(fields).toString(),
  });
  await response.text();
  await channel.idle();
  return response.status;
}

const incoming = (body: string, sid: string, from = ME) => ({ From: `whatsapp:${from}`, To: "whatsapp:+14155238886", Body: body, MessageSid: sid, NumMedia: "0" });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "omb-whatsapp-"));
  settings = createWhatsAppSettings(dir);
  clock = 1_000_000;
  settings.update({ accountSid: SID, authToken: TOKEN, allowed: [ME], enabled: true }, clock);
  delivered = [];
  sent = [];
  paths = new Map();
  threads = [];
  twilioFails = false;
  teamCloud = false;
  reachable = true;
  inbox = [];
  listFails = false;
  listGate = null;
  endlessPages = false;
  claimRefused = false;
  released = 0;
  channel = makeChannel();
  server = createServer((req, res) => void channel.handleTwilio(req, res, base, () => {
    if (claimRefused) throw Object.assign(new Error("moving"), { status: 503 });
    return () => { released += 1; };
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

describe("settings", () => {
  it("keeps the auth token sealed and never shows it", () => {
    expect(readFileSync(join(dir, "whatsapp.json"), "utf8")).not.toContain(TOKEN);
    expect(settings.publicSettings()).toEqual({ enabled: true, accountSid: SID, hasToken: true, from: "whatsapp:+14155238886", allowed: [ME] });
    expect(settings.authToken()).toBe(TOKEN);
    settings.update({ authToken: "" });
    expect(settings.authToken()).toBe(TOKEN);
  });

  it("refuses a number that is not one and switching on without credentials", () => {
    expect(() => settings.update({ allowed: ["call me"] })).toThrow(/not a phone number/);
    const empty = createWhatsAppSettings(mkdtempSync(join(tmpdir(), "omb-whatsapp-empty-")));
    expect(() => empty.update({ enabled: true })).toThrow(/before switching WhatsApp on/);
  });
});

describe("incoming WhatsApp messages", () => {
  it("passes the owner's message to MausBot in its own WhatsApp thread", async () => {
    expect(await post(incoming("Plan the launch", "SM1"))).toBe(200);
    expect(delivered).toEqual([{ botId: "maus", threadId: "t1", text: "Plan the launch", sendId: "wa_SM1" }]);
    expect(await post(incoming("And book the room", "SM2"))).toBe(200);
    expect(delivered.map((entry) => entry.threadId)).toEqual(["t1", "t1"]);
    expect(channel.prompt("t1")).toBe(WHATSAPP_PROMPT);
    expect(channel.prompt("other")).toBe("");
  });

  it("refuses a bad signature, ignores strangers and a repeated delivery", async () => {
    expect(await post(incoming("hi", "SM1"), "forged")).toBe(403);
    expect(await post(incoming("hi", "SM2", "+19998887777"))).toBe(200);
    expect(await post(incoming("hi", "SM3"))).toBe(200);
    expect(await post(incoming("hi", "SM3"))).toBe(200);
    expect(delivered.map((entry) => entry.sendId)).toEqual(["wa_SM3"]);
  });

  it("does nothing while switched off or on a team server", async () => {
    settings.update({ enabled: false });
    expect(await post(incoming("hi", "SM1"))).toBe(404);
    settings.update({ enabled: true });
    teamCloud = true;
    channel = makeChannel();
    expect(await post(incoming("hi", "SM2"))).toBe(404);
    expect(delivered).toEqual([]);
  });

  it("starts a fresh conversation on /new and explains media it cannot read", async () => {
    await post(incoming("first", "SM1"));
    await post(incoming("/new", "SM2"));
    await post(incoming("second", "SM3"));
    expect(delivered.map((entry) => entry.threadId)).toEqual(["t1", "t2"]);
    await post({ ...incoming("", "SM4"), NumMedia: "1" });
    expect(sent.map((entry) => entry.body)).toEqual([
      "Started a new conversation with MausBot.",
      "I can only read text messages here for now. Send it as text, or open OpenMausBot.",
    ]);
  });
});

describe("replies", () => {
  it("sends what MausBot said after the person's message, then only what is new", async () => {
    await post(incoming("Plan the launch", "SM1"));
    paths.get("t1")!.push(msg("b1", "bot", "On it: I've asked the **Marketing** Chief of Staff."));
    await channel.noteTurnCompleted("t1");
    expect(sent).toEqual([{ to: `whatsapp:${ME}`, body: "On it: I've asked the *Marketing* Chief of Staff." }]);
    paths.get("t1")!.push(msg("b2", "bot", "Done: the launch plan is ready."));
    await channel.noteTurnCompleted("t1");
    expect(sent.map((entry) => entry.body)).toEqual([
      "On it: I've asked the *Marketing* Chief of Staff.",
      "Done: the launch plan is ready.",
    ]);
    await channel.noteTurnCompleted("t1");
    expect(sent).toHaveLength(2);
  });

  it("tells the person when MausBot is waiting for their approval in the app", async () => {
    await post(incoming("Send the invoice", "SM1"));
    paths.get("t1")!.push(msg("c1", "bot", "", { kind: "options", card: { requestId: "r1" } } as Partial<Message>));
    await channel.noteTurnCompleted("t1");
    expect(sent.map((entry) => entry.body)).toEqual(["MausBot is waiting for your OK in OpenMausBot. Open the app to answer it."]);
  });

  it("keeps a reply in the app after WhatsApp's 24-hour window and records why", async () => {
    await post(incoming("Remind me later", "SM1"));
    clock += SESSION_WINDOW_MS + 1;
    paths.get("t1")!.push(msg("b1", "bot", "Here is your reminder."));
    await channel.noteTurnCompleted("t1");
    expect(sent).toEqual([]);
    expect(settings.publicSettings().lastError?.message).toMatch(/24 hours/);
  });

  it("retries a reply Twilio refused at the next finished turn", async () => {
    await post(incoming("Hi", "SM1"));
    twilioFails = true;
    paths.get("t1")!.push(msg("b1", "bot", "Hello!"));
    await channel.noteTurnCompleted("t1");
    expect(settings.publicSettings().lastError?.message).toMatch(/error 21608/);
    twilioFails = false;
    await channel.noteTurnCompleted("t1");
    expect(sent.map((entry) => entry.body)).toEqual(["Hello!"]);
  });

  it("ignores threads that are not a WhatsApp chat", async () => {
    paths.set("x", [msg("b1", "bot", "elsewhere")]);
    await channel.noteTurnCompleted("x");
    expect(sent).toEqual([]);
  });

  it("sends a test message to the first allowed number", async () => {
    expect(await channel.sendTest()).toEqual({ ok: true });
    expect(sent).toEqual([{ to: `whatsapp:${ME}`, body: "OpenMausBot is connected. Message this number to reach MausBot." }]);
  });
});

const NEW = "+14155550199";
const row = (sid: string, body: string, at: number, from = ME) =>
  ({ sid, from: `whatsapp:${from}`, to: "whatsapp:+14155238886", body, direction: "inbound", date_created: new Date(at).toUTCString(), num_media: "0" });

describe("linking a phone", () => {
  it("links the number that sends a live code, switches WhatsApp on and says hello", async () => {
    settings.update({ enabled: false, allowed: [] });
    expect((await channel.verify())).toEqual({ ok: true, name: "Azad" });
    const { code, linkUrl } = channel.startLink();
    expect(linkUrl).toBe(`https://wa.me/14155238886?text=link%20${code}`);
    expect(await post(incoming(`link ${code}`, "SM1", NEW))).toBe(200);
    expect(settings.publicSettings()).toMatchObject({ enabled: true, allowed: [NEW] });
    expect(settings.publicSettings().linkExpiresAt).toBeUndefined();
    expect(sent).toEqual([{ to: `whatsapp:${NEW}`, body: "You're connected. I'm MausBot: message me here any time, and I'll get it done or hand it to the right team." }]);
    expect(delivered).toEqual([]);
    await post(incoming("Plan my week", "SM2", NEW));
    expect(delivered.map((entry) => entry.text)).toEqual(["Plan my week"]);
  });

  it("ignores a wrong, expired or reused code, and the sandbox join message", async () => {
    const { code } = channel.startLink();
    const wrong = code === "000000" ? "111111" : "000000";
    await post(incoming(`link ${wrong}`, "SM1", NEW));
    await post(incoming("join brave-tiger", "SM2", NEW));
    expect(settings.publicSettings().allowed).toEqual([ME]);
    await post(incoming(`link ${code}`, "SM3", NEW));
    expect(settings.publicSettings().allowed).toEqual([ME, NEW]);
    await post(incoming(`link ${code}`, "SM4", "+14155550188"));
    expect(settings.publicSettings().allowed).toEqual([ME, NEW]);
    const late = channel.startLink();
    clock += 11 * 60_000;
    await post(incoming(`link ${late.code}`, "SM5", "+14155550177"));
    expect(settings.publicSettings().allowed).toEqual([ME, NEW]);
  });
});

describe("checking Twilio when this computer is not reachable", () => {
  beforeEach(() => {
    reachable = false;
    settings.setAccountName("Azad", clock - 60_000);
  });

  it("reads each new message once, skipping ones from before setup", async () => {
    inbox = [row("SM2", "second", clock + 2_000), row("SM1", "first", clock + 1_000), row("SM0", "before setup", clock - 120_000)];
    expect(await channel.poll()).toBe(POLL_MS);
    await channel.idle();
    expect(delivered.map((entry) => entry.text)).toEqual(["first", "second"]);
    await channel.poll();
    await channel.idle();
    expect(delivered).toHaveLength(2);
    expect(channel.mode()).toBe("polling");
  });

  it("links a phone from a polled message too", async () => {
    settings.update({ enabled: false, allowed: [] });
    const { code } = channel.startLink();
    inbox = [row("SM9", `link ${code}`, clock + 1_000, NEW)];
    await channel.poll();
    await channel.idle();
    expect(settings.publicSettings()).toMatchObject({ enabled: true, allowed: [NEW] });
  });

  it("backs off and says why when Twilio can't be read", async () => {
    listFails = true;
    expect(await channel.poll()).toBe(POLL_BACKOFF_MS);
    expect(settings.publicSettings().lastError?.message).toMatch(/Couldn't check Twilio/);
  });

  it("does not check Twilio while its webhook can reach this computer", async () => {
    reachable = true;
    inbox = [row("SM1", "first", clock - 1_000)];
    await channel.poll();
    await channel.idle();
    expect(delivered).toEqual([]);
    expect(channel.mode()).toBe("instant");
  });
});

describe("review fixes", () => {
  it("keeps working credentials when Twilio refuses new ones", async () => {
    expect(await channel.verify({ authToken: "bad" })).toEqual({ ok: false, error: "Twilio didn't accept that Account SID and auth token." });
    expect(settings.authToken()).toBe(TOKEN);
    expect(settings.publicSettings().enabled).toBe(true);
    expect(await channel.verify({ authToken: "fresh-token" })).toEqual({ ok: true, name: "Azad" });
    expect(settings.authToken()).toBe("fresh-token");
  });

  it("does not replay messages that arrived while WhatsApp was off", async () => {
    reachable = false;
    settings.setAccountName("Azad", clock - 60_000);
    settings.update({ enabled: false }, clock);
    clock += 3 * 24 * 60 * 60_000;
    inbox = [row("SMold", "delete everything", clock - 60_000)];
    settings.update({ enabled: true }, clock);
    await channel.poll();
    await channel.idle();
    expect(delivered).toEqual([]);
  });

  it("answers Twilio even when recording the message fails", async () => {
    const original = settings.firstSighting;
    settings.firstSighting = () => { throw new Error("disk full"); };
    expect(await post(incoming("hi", "SM1"))).toBe(200);
    settings.firstSighting = original;
    expect(delivered).toEqual([]);
  });
});

describe("a check that a switch happened during", () => {
  it("delivers nothing and keeps the cursor when WhatsApp was switched off and on while Twilio answered", async () => {
    reachable = false;
    settings.setAccountName("Azad", clock - 60_000);
    const before = settings.load().pollSince;
    let release!: () => void;
    listGate = new Promise((resolve) => { release = resolve; });
    inbox = [row("SMlate", "old instruction", clock + 1_000)];
    const checking = channel.poll();
    settings.update({ enabled: false }, clock);
    clock += 60_000;
    settings.update({ enabled: true }, clock);
    release();
    await checking;
    await channel.idle();
    expect(delivered).toEqual([]);
    expect(settings.load().pollSince).toBe(clock);
    expect(settings.load().pollSince).not.toBe(before);
  });
});

describe("second review fixes", () => {
  it("takes the webhook path only for a public HTTPS address", () => {
    expect(isPublicHttps("https://bots.example.com")).toBe(true);
    expect(isPublicHttps("http://bots.example.com")).toBe(false);
    expect(isPublicHttps("https://127.0.0.1:8800")).toBe(false);
    expect(isPublicHttps("https://localhost")).toBe(false);
    expect(isPublicHttps("not a url")).toBe(false);
  });

  it("answers 503 and records nothing while the server refuses work, then takes the same message later", async () => {
    claimRefused = true;
    expect(await post(incoming("During the move", "SM1"))).toBe(503);
    expect(delivered).toEqual([]);
    claimRefused = false;
    expect(await post(incoming("During the move", "SM1"))).toBe(200);
    expect(delivered.map((entry) => entry.sendId)).toEqual(["wa_SM1"]);
    expect(released).toBe(1);
  });

  it("does not check while paused for maintenance, and a check paused mid-way delivers nothing", async () => {
    reachable = false;
    settings.setAccountName("Azad", clock - 60_000);
    inbox = [row("SMp1", "while backing up", clock + 1_000)];
    channel.pause();
    await channel.poll();
    expect(delivered).toEqual([]);
    channel.resume();
    let release!: () => void;
    listGate = new Promise((resolve) => { release = resolve; });
    const checking = channel.poll();
    expect(channel.busy()).toBe(true);
    channel.pause();
    release();
    await checking;
    await channel.idle();
    expect(delivered).toEqual([]);
    expect(channel.busy()).toBe(false);
    channel.resume();
    listGate = null;
    await channel.poll();
    await channel.idle();
    expect(delivered.map((entry) => entry.text)).toEqual(["while backing up"]);
  });

  it("moves the cursor past a check that hit the page limit, so it never gets stuck", async () => {
    reachable = false;
    settings.setAccountName("Azad", clock - 60_000);
    endlessPages = true;
    inbox = [row("SMt2", "newer", clock + 2_000), row("SMt1", "older", clock + 1_000)];
    await channel.poll();
    await channel.idle();
    expect(settings.publicSettings().lastError?.message).toBe("More new messages arrived than one check reads; older ones were skipped.");
    expect(settings.load().pollSince).toBe(clock + 2_000);
    expect(delivered.map((entry) => entry.text)).toEqual(["older", "newer"]);
    await channel.poll();
    await channel.idle();
    expect(delivered).toHaveLength(2);
  });
});

describe("third review fixes", () => {
  it("cancels a link code after five wrong tries, so it can't be guessed", async () => {
    const { code } = channel.startLink();
    const wrong = (i: number) => String((Number(code) + 1 + i) % 1_000_000).padStart(6, "0");
    for (let i = 0; i < 5; i += 1) await post(incoming(`link ${wrong(i)}`, `SMw${i}`, NEW));
    expect(settings.publicSettings().linkExpiresAt).toBeUndefined();
    await post(incoming(`link ${code}`, "SMok", NEW));
    expect(settings.publicSettings().allowed).toEqual([ME]);
  });

  it("reads a second message from the same second as the last one it read", async () => {
    reachable = false;
    settings.setAccountName("Azad", clock - 60_000);
    const second = Math.floor((clock + 5_000) / 1_000) * 1_000;
    inbox = [row("SMa", "first", second)];
    await channel.poll();
    await channel.idle();
    inbox = [row("SMb", "second", second), row("SMa", "first", second)];
    await channel.poll();
    await channel.idle();
    expect(delivered.map((entry) => entry.text)).toEqual(["first", "second"]);
  });

  it("runs one timer chain when restarted during a check, and none after stopping", async () => {
    reachable = false;
    settings.setAccountName("Azad", clock - 60_000);
    let release!: () => void;
    listGate = new Promise((resolve) => { release = resolve; });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      channel.start();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      const first = lists;
      expect(first).toBeGreaterThan(0);
      channel.stop();
      channel.start();
      release();
      listGate = null;
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(POLL_MS);
      expect(lists - first).toBe(1);
      channel.stop();
      const stopped = lists;
      await vi.advanceTimersByTimeAsync(POLL_MS * 3);
      expect(lists).toBe(stopped);
    } finally {
      channel.stop();
      vi.useRealTimers();
    }
  });
});

