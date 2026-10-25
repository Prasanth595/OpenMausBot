// Twilio's WhatsApp API: the signature every incoming request carries, the form fields it posts, and the one call that
// sends a message. https://www.twilio.com/docs/usage/security
import { createHmac, timingSafeEqual } from "node:crypto";

import { splitConversationalReply } from "../../shared/reply-style.ts";

export const TWILIO_API_BASE = "https://api.twilio.com";
export const SANDBOX_SENDER = "whatsapp:+14155238886";
/** Twilio's limit for one WhatsApp message body. */
export const MESSAGE_MAX_CHARS = 1600;
/** A reply longer than this many messages stops with a pointer to the app. */
export const MAX_MESSAGES_PER_REPLY = 5;
/** WhatsApp only lets a business answer freely for this long after the person's last message. */
export const SESSION_WINDOW_MS = 24 * 60 * 60_000;

/** Base64 HMAC-SHA1 of the exact URL Twilio called, then every form field's name and value in case-sensitive name order. */
export function twilioSignature(url: string, params: Readonly<Record<string, string>>, authToken: string): string {
  const signed = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(signed, "utf8").digest("base64");
}

export function verifyTwilioSignature(url: string, params: Readonly<Record<string, string>>, signature: string | undefined, authToken: string): boolean {
  if (!signature || !authToken) return false;
  const expected = Buffer.from(twilioSignature(url, params, authToken));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** "whatsapp:+1 (415) 555-0100" and "+14155550100" both read as "+14155550100"; anything that is not a number is "". */
export function normalizeNumber(raw: string): string {
  const digits = raw.trim().replace(/^whatsapp:/i, "").replace(/[\s().-]/g, "");
  return /^\+?[1-9]\d{6,14}$/.test(digits) ? (digits.startsWith("+") ? digits : `+${digits}`) : "";
}

/** How a message travels: Twilio marks WhatsApp addresses with a "whatsapp:" prefix and leaves SMS numbers bare. */
export type Medium = "whatsapp" | "sms";

export const mediumOf = (address: string): Medium => (/^whatsapp:/i.test(address.trim()) ? "whatsapp" : "sms");

export interface InboundMessage {
  medium: Medium;
  from: string;
  to: string;
  body: string;
  messageSid: string;
  profileName?: string;
  numMedia: number;
}

/** Null for anything that is not a person's message (a delivery status callback, a malformed post). */
export function parseInbound(form: Readonly<Record<string, string>>): InboundMessage | null {
  const from = normalizeNumber(form.From ?? "");
  const messageSid = (form.MessageSid ?? form.SmsMessageSid ?? "").trim();
  if (!from || !messageSid || form.MessageStatus) return null;
  const numMedia = Number.parseInt(form.NumMedia ?? "0", 10);
  return {
    medium: mediumOf(form.From ?? ""),
    from,
    to: normalizeNumber(form.To ?? ""),
    body: (form.Body ?? "").trim(),
    messageSid,
    ...(form.ProfileName?.trim() ? { profileName: form.ProfileName.trim().slice(0, 80) } : {}),
    numMedia: Number.isFinite(numMedia) && numMedia > 0 ? numMedia : 0,
  };
}

/** Markdown as WhatsApp shows it: *bold*, _italic_, ~strike~, code kept, headings bold, tables as plain lines. */
export function whatsappText(markdown: string): string {
  const out: string[] = [];
  let fenced = false;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      out.push("```");
      continue;
    }
    if (fenced) {
      out.push(line);
      continue;
    }
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)) continue;
    let text = line;
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(text);
    if (heading) text = `**${heading[1]!.trim()}**`;
    if (/^\s*\|.*\|\s*$/.test(text)) text = text.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()).filter(Boolean).join(" · ");
    text = text
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
      .replace(/(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g, "$1_$2_")
      .replace(/\*\*([^*\n]+?)\*\*/g, "*$1*")
      .replace(/__([^_\n]+?)__/g, "*$1*")
      .replace(/~~([^~\n]+?)~~/g, "~$1~");
    out.push(text);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Markdown as a plain text message: no markers, links as "text (url)", tables as plain lines. */
export function smsText(markdown: string): string {
  return whatsappText(markdown).replace(/```/g, "").replace(/(^|\s)[*_~]([^*_~\n]+)[*_~](?=\s|[.,;:!?)]|$)/g, "$1$2").replace(/\n{3,}/g, "\n\n").trim();
}

export const formatFor = (medium: Medium, markdown: string): string => (medium === "sms" ? smsText(markdown) : whatsappText(markdown));

/** WhatsApp-sized messages: whole paragraphs where they fit, hard cuts only inside one that is longer than a message. */
export function whatsappChunks(text: string, max = MESSAGE_MAX_CHARS): string[] {
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const part of splitConversationalReply(text)) {
    for (let piece = part; piece;) {
      const room = current ? max - current.length - 2 : max;
      if (piece.length <= room) {
        current = current ? `${current}\n\n${piece}` : piece;
        piece = "";
      } else if (current) {
        push();
      } else {
        const cut = Math.max(piece.lastIndexOf("\n", max), piece.lastIndexOf(" ", max));
        const at = cut > max / 2 ? cut : max;
        chunks.push(piece.slice(0, at).trim());
        piece = piece.slice(at).trim();
      }
    }
  }
  push();
  return chunks;
}

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  /** The WhatsApp sender, "whatsapp:+14155238886" for the sandbox. */
  from: string;
  /** MausBot's own number for text messages, when it has one. */
  smsFrom?: string;
}

/** The sender and the recipient address Twilio expects for a medium, or null when there is no sender for it. */
export function addresses(credentials: TwilioCredentials, to: string, medium: Medium): { from: string; to: string } | null {
  const number = normalizeNumber(to);
  if (medium === "sms") return credentials.smsFrom ? { from: normalizeNumber(credentials.smsFrom), to: number } : null;
  return { from: credentials.from, to: `whatsapp:${number}` };
}

export type SendResult = { ok: true; sid: string } | { ok: false; error: string; code?: number; status?: number };

export async function sendWhatsApp(
  credentials: TwilioCredentials,
  to: string,
  body: string,
  options: { fetchImpl?: typeof fetch; apiBase?: string; medium?: Medium } = {},
): Promise<SendResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const route = addresses(credentials, to, options.medium ?? "whatsapp");
  if (!route) return { ok: false, error: "MausBot has no number for text messages yet." };
  const url = `${options.apiBase ?? TWILIO_API_BASE}/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}/Messages.json`;
  const form = new URLSearchParams({ To: route.to, From: route.from, Body: body.slice(0, MESSAGE_MAX_CHARS) });
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: basicAuth(credentials), "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await response.json().catch(() => ({})) as { sid?: unknown; message?: unknown; code?: unknown };
    if (response.ok && typeof json.sid === "string") return { ok: true, sid: json.sid };
    return {
      ok: false,
      error: typeof json.message === "string" ? json.message : `Twilio answered ${response.status}`,
      ...(typeof json.code === "number" ? { code: json.code } : {}),
      status: response.status,
    };
  } catch (error) {
    return { ok: false, error: `Could not reach Twilio: ${(error as Error).message}` };
  }
}

const basicAuth = (credentials: Pick<TwilioCredentials, "accountSid" | "authToken">) =>
  `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64")}`;

/** Whether Twilio accepts these credentials, and the account's name to show back. */
export async function fetchAccount(
  credentials: Pick<TwilioCredentials, "accountSid" | "authToken">,
  options: { fetchImpl?: typeof fetch; apiBase?: string } = {},
): Promise<{ ok: true; name: string } | { ok: false; error: string; status?: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${options.apiBase ?? TWILIO_API_BASE}/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}.json`;
  try {
    const response = await fetchImpl(url, { headers: { authorization: basicAuth(credentials) }, signal: AbortSignal.timeout(15_000) });
    const json = await response.json().catch(() => ({})) as { friendly_name?: unknown; message?: unknown };
    if (response.ok) return { ok: true, name: typeof json.friendly_name === "string" && json.friendly_name.trim() ? json.friendly_name.trim().slice(0, 80) : "your Twilio account" };
    return {
      ok: false,
      error: response.status === 401 || response.status === 404 ? "Twilio didn't accept that Account SID and auth token." : typeof json.message === "string" ? json.message : `Twilio answered ${response.status}`,
      status: response.status,
    };
  } catch (error) {
    return { ok: false, error: `Could not reach Twilio: ${(error as Error).message}` };
  }
}

const MAX_POLL_PAGES = 20;

/** Twilio sorts by when a message was sent, which can trail when it arrived; paging stops only this far past `since`. */
const SENT_ORDER_MARGIN_MS = 5 * 60_000;

export interface PolledMessage extends InboundMessage {
  at: number;
}

/** Messages people sent to `credentials.from` after `since`, oldest first: how a computer with no public address hears them. */
export async function listInbound(
  credentials: TwilioCredentials,
  since: number,
  options: { fetchImpl?: typeof fetch; apiBase?: string; to?: string } = {},
): Promise<{ ok: true; messages: PolledMessage[]; truncated: boolean } | { ok: false; error: string; status?: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  // Twilio filters by day only; the exact cut happens below.
  const query = new URLSearchParams({ To: options.to ?? credentials.from, "DateSent>": new Date(since).toISOString().slice(0, 10), PageSize: "50" });
  const url = `${options.apiBase ?? TWILIO_API_BASE}/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}/Messages.json?${query}`;
  try {
    const rows: Array<Record<string, unknown>> = [];
    let pageUrl: string | undefined = url;
    for (let page = 0; pageUrl && page < MAX_POLL_PAGES; page += 1) {
      const response = await fetchImpl(pageUrl, { headers: { authorization: basicAuth(credentials) }, signal: AbortSignal.timeout(15_000) });
      const json = await response.json().catch(() => ({})) as { messages?: unknown; message?: unknown; next_page_uri?: unknown };
      if (!response.ok) return { ok: false, error: typeof json.message === "string" ? json.message : `Twilio answered ${response.status}`, status: response.status };
      const batch = Array.isArray(json.messages) ? json.messages as Array<Record<string, unknown>> : [];
      rows.push(...batch);
      const sent = batch.map((row) => Date.parse(String(row.date_sent ?? row.date_created ?? ""))).filter(Number.isFinite);
      const reachedSince = sent.length > 0 && Math.min(...sent) < since - SENT_ORDER_MARGIN_MS;
      pageUrl = !reachedSince && typeof json.next_page_uri === "string" && json.next_page_uri
        ? new URL(json.next_page_uri, options.apiBase ?? TWILIO_API_BASE).toString()
        : undefined;
    }
    const truncated = Boolean(pageUrl);
    const messages = rows.flatMap((row): PolledMessage[] => {
      if (row.direction !== "inbound") return [];
      const at = Date.parse(String(row.date_created ?? ""));
      // Twilio's times are whole seconds, so a message from the cursor's own second is read again; its SID de-duplicates it.
      if (!Number.isFinite(at) || at < since) return [];
      const parsed = parseInbound({ From: String(row.from ?? ""), To: String(row.to ?? ""), Body: String(row.body ?? ""), MessageSid: String(row.sid ?? ""), NumMedia: String(row.num_media ?? "0") });
      return parsed ? [{ ...parsed, at }] : [];
    });
    return { ok: true, messages: messages.sort((a, b) => a.at - b.at), truncated };
  } catch (error) {
    return { ok: false, error: `Could not reach Twilio: ${(error as Error).message}` };
  }
}

/** Opens the phone's Messages app with `text` already typed to `number`. */
export function smsLink(number: string, text: string): string {
  return `sms:${normalizeNumber(number)}?&body=${encodeURIComponent(text)}`;
}

/** Opens WhatsApp on a phone (or WhatsApp Web) with `text` already typed to `sender`. */
export function whatsappLink(sender: string, text: string): string {
  return `https://wa.me/${normalizeNumber(sender).replace(/^\+/, "")}?text=${encodeURIComponent(text)}`;
}
