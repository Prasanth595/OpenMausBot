// WhatsApp, through Twilio, as a way to talk to the person's MausBot. Only the owner's own numbers are heard. Each
// number has one MausBot thread; MausBot hands real work to the right department's Chief of Staff and every finished
// turn in that thread, including its resume when a Chief's result returns, is sent back to the phone.
import type { IncomingMessage, ServerResponse } from "node:http";

import type { Message } from "../store.ts";
import type { WhatsAppSettings } from "./settings.ts";
import {
  MAX_MESSAGES_PER_REPLY,
  parseInbound,
  sendWhatsApp,
  SESSION_WINDOW_MS,
  verifyTwilioSignature,
  whatsappChunks,
  whatsappText,
  type TwilioCredentials,
} from "./twilio.ts";

export const WHATSAPP_PATH = "/whatsapp/twilio";
export const WHATSAPP_THREAD_TITLE = "WhatsApp";
const MAX_FORM_BYTES = 64 * 1024;

export const WHATSAPP_PROMPT = [
  "This conversation is the person's WhatsApp chat with you. Your replies go to their phone as WhatsApp messages: keep them short, in plain sentences, with no tables or headings. They cannot see cards, forms, buttons or files here, so ask questions in text with numbered options.",
  "You are their single point of contact. Answer quick questions and small requests yourself. For real work that belongs to a department, hand it to that department's Chief of Staff (marked [Chief of Staff] in your roster; use list_bots if unsure) with coordinate_bots and a clear, self-contained brief, then say in one short line who has it. When the result comes back, send one short summary of what was done.",
  "You can only reach the departments the person lets you coordinate. If the work belongs to a department that is not in your roster, do what you can yourself and tell them in one line that they can add it in your settings under Access → Additional departments.",
  "Anything that needs the person's approval waits for them in OpenMausBot: say so in one line and tell them what to approve.",
].join(" ");

export interface WhatsAppChannelDeps {
  settings: WhatsAppSettings;
  /** A Team Cloud's conversations belong to several people, so the channel stays off there. */
  teamCloud: boolean;
  defaultBot(): { id: string; name: string } | undefined;
  threadExists(botId: string, threadId: string): boolean;
  createThread(botId: string, title: string): string | null;
  /** A message from the person, as if they typed it: it starts, steers or queues like any other. */
  deliver(botId: string, threadId: string, text: string, sendId: string): Promise<void>;
  activePath(threadId: string): Message[];
  needsInput(message: Message): boolean;
  fetchImpl?: typeof fetch;
  apiBase?: string;
  now?: () => number;
  log?: (line: string) => void;
}

function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_FORM_BYTES) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")))));
    req.on("error", reject);
  });
}

function reply(res: ServerResponse, status: number, body = "<Response></Response>"): void {
  res.writeHead(status, { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

export function createWhatsAppChannel(deps: WhatsAppChannelDeps) {
  const now = () => deps.now?.() ?? Date.now();
  const log = (line: string) => deps.log?.(`whatsapp: ${line}`);
  // One send at a time per number, so replies arrive in order.
  const lanes = new Map<string, Promise<void>>();
  const inLane = (number: string, work: () => Promise<void>): Promise<void> => {
    const next = (lanes.get(number) ?? Promise.resolve()).then(work).catch((error: unknown) => {
      log(`${(error as Error).message}`);
    });
    lanes.set(number, next);
    void next.finally(() => {
      if (lanes.get(number) === next) lanes.delete(number);
    });
    return next;
  };

  const active = () => !deps.teamCloud && deps.settings.load().enabled;

  function credentials(): TwilioCredentials | null {
    const state = deps.settings.load();
    const authToken = deps.settings.authToken(state);
    return state.accountSid && authToken ? { accountSid: state.accountSid, authToken, from: state.from } : null;
  }

  async function send(number: string, body: string): Promise<boolean> {
    const creds = credentials();
    if (!creds) return false;
    const result = await sendWhatsApp(creds, number, body, { fetchImpl: deps.fetchImpl, apiBase: deps.apiBase });
    if (!result.ok) {
      deps.settings.recordError(`Twilio refused a message${result.code ? ` (error ${result.code})` : ""}: ${result.error}`, now());
      log(`send failed: ${result.error}`);
    }
    return result.ok;
  }

  function threadFor(number: string, botId: string, fresh: boolean): string | null {
    const current = deps.settings.contact(number).threadId;
    if (!fresh && current && deps.threadExists(botId, current)) return current;
    const threadId = deps.createThread(botId, WHATSAPP_THREAD_TITLE);
    if (threadId) deps.settings.patchContact(number, { threadId, lastSentMessageId: undefined });
    return threadId;
  }

  async function receive(number: string, body: string, numMedia: number, messageSid: string): Promise<void> {
    const bot = deps.defaultBot();
    if (!bot) {
      await send(number, "OpenMausBot has no MausBot to answer here yet.");
      return;
    }
    if (/^\/new$/i.test(body)) {
      const threadId = threadFor(number, bot.id, true);
      await send(number, threadId ? `Started a new conversation with ${bot.name}.` : "Couldn't start a new conversation.");
      return;
    }
    if (!body) {
      if (numMedia) await send(number, "I can only read text messages here for now. Send it as text, or open OpenMausBot.");
      return;
    }
    const threadId = threadFor(number, bot.id, false);
    if (!threadId) {
      await send(number, "Couldn't open a conversation with MausBot. Try again in OpenMausBot.");
      return;
    }
    try {
      await deps.deliver(bot.id, threadId, body, `wa_${messageSid}`);
    } catch (error) {
      const reason = (error as Error).message;
      deps.settings.recordError(`A WhatsApp message didn't reach ${bot.name}: ${reason}`, now());
      await send(number, `That didn't reach ${bot.name}: ${reason}`);
    }
  }

  /** Twilio's "a message comes in" webhook. It answers at once; the work runs after. */
  async function handleTwilio(req: IncomingMessage, res: ServerResponse, publicBaseUrl: string): Promise<void> {
    if (req.method !== "POST") return reply(res, 405);
    if (!active()) return reply(res, 404);
    let form: Record<string, string>;
    try {
      form = await readForm(req);
    } catch (error) {
      return reply(res, (error as { status?: number }).status ?? 400);
    }
    const url = `${publicBaseUrl.replace(/\/+$/, "")}${req.url ?? WHATSAPP_PATH}`;
    const signature = typeof req.headers["x-twilio-signature"] === "string" ? req.headers["x-twilio-signature"] : undefined;
    if (!verifyTwilioSignature(url, form, signature, deps.settings.authToken())) {
      log("refused a request whose signature did not match");
      return reply(res, 403);
    }
    reply(res, 200);
    const message = parseInbound(form);
    if (!message) return;
    if (!deps.settings.load().allowed.includes(message.from)) {
      log("ignored a message from a number that is not allowed");
      return;
    }
    if (!deps.settings.firstSighting(message.messageSid)) return;
    deps.settings.patchContact(message.from, { lastInboundAt: now() });
    await inLane(message.from, () => receive(message.from, message.body, message.numMedia, message.messageSid));
  }

  /** Sends what MausBot said since the last reply. Called on every finished turn; a no-op for any other thread. */
  function noteTurnCompleted(threadId: string): Promise<void> {
    if (!active()) return Promise.resolve();
    const number = deps.settings.numberForThread(threadId);
    if (!number) return Promise.resolve();
    return inLane(number, async () => {
      const contact = deps.settings.contact(number);
      const path = deps.activePath(threadId);
      const cursor = contact.lastSentMessageId ? path.findIndex((message) => message.id === contact.lastSentMessageId) : -1;
      const start = cursor >= 0 ? cursor + 1 : path.findLastIndex((message) => message.role === "user") + 1;
      const fresh = path.slice(start);
      const said = fresh.filter((message) => message.role === "bot" && message.kind === "text" && message.text?.trim());
      const waiting = fresh.some((message) => deps.needsInput(message));
      const last = fresh.at(-1);
      if (!last || (!said.length && !waiting)) return;
      if (now() - (contact.lastInboundAt ?? 0) > SESSION_WINDOW_MS) {
        deps.settings.recordError("A reply stayed in OpenMausBot: WhatsApp only allows replies within 24 hours of your last message.", now());
        deps.settings.patchContact(number, { lastSentMessageId: last.id });
        return;
      }
      let chunks = whatsappChunks(whatsappText(said.map((message) => message.text!.trim()).join("\n\n")));
      if (waiting) chunks.push("MausBot is waiting for your OK in OpenMausBot. Open the app to answer it.");
      if (chunks.length > MAX_MESSAGES_PER_REPLY) {
        chunks = [...chunks.slice(0, MAX_MESSAGES_PER_REPLY - 1), "…the rest is in OpenMausBot."];
      }
      for (const chunk of chunks) {
        if (!(await send(number, chunk))) return;
      }
      deps.settings.patchContact(number, { lastSentMessageId: last.id });
    });
  }

  function prompt(threadId: string): string {
    return active() && deps.settings.numberForThread(threadId) ? WHATSAPP_PROMPT : "";
  }

  async function sendTest(): Promise<{ ok: true } | { ok: false; error: string }> {
    const state = deps.settings.load();
    const to = state.allowed[0];
    if (!to || !credentials()) return { ok: false, error: "Add the Account SID, the auth token and your WhatsApp number first." };
    const sent = await send(to, "OpenMausBot is connected. Message this number to reach MausBot.");
    return sent ? { ok: true } : { ok: false, error: deps.settings.load().lastError?.message ?? "Twilio refused the message." };
  }

  return { handleTwilio, noteTurnCompleted, prompt, sendTest, idle: () => Promise.allSettled(lanes.values()) };
}

export type WhatsAppChannel = ReturnType<typeof createWhatsAppChannel>;
