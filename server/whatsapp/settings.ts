// The WhatsApp channel's own state file. The Twilio auth token is sealed with a 0600 key file of its own that no backup
// carries, as webhooks.ts does for webhook secrets, so whatsapp.json alone never reveals it.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import { normalizeNumber, SANDBOX_SENDER } from "./twilio.ts";

export const WHATSAPP_FILE = "whatsapp.json";
export const WHATSAPP_KEY_FILE = "whatsapp-key";
export const MAX_ALLOWED_NUMBERS = 5;
/** How long a "link 123456" code stays good. */
export const LINK_TTL_MS = 10 * 60_000;
const JOIN_PHRASE = /^join [a-z]+(?:-[a-z]+)+$/;
const SEEN_MAX = 500;

const contactSchema = z.object({
  threadId: z.string().optional(),
  /** The newest bot message already sent to this number; replies resume after it. */
  lastSentMessageId: z.string().optional(),
  lastInboundAt: z.number().optional(),
});

const stateSchema = z.object({
  enabled: z.boolean().default(false),
  accountSid: z.string().default(""),
  sealedToken: z.string().optional(),
  from: z.string().default(SANDBOX_SENDER),
  allowed: z.array(z.string()).default([]),
  contacts: z.record(z.string(), contactSchema).default({}),
  seen: z.array(z.string()).default([]),
  lastError: z.object({ at: z.number(), message: z.string() }).optional(),
  accountName: z.string().optional(),
  /** The sandbox's "join two-words" phrase, shown in Twilio's console; there is no API for it. */
  joinPhrase: z.string().optional(),
  link: z.object({ codeHash: z.string(), expiresAt: z.number() }).optional(),
  /** Messages before this are never read when checking Twilio for new ones. */
  pollSince: z.number().optional(),
});

export type WhatsAppState = z.output<typeof stateSchema>;
export type WhatsAppContact = z.output<typeof contactSchema>;

export interface PublicWhatsAppSettings {
  enabled: boolean;
  accountSid: string;
  hasToken: boolean;
  from: string;
  allowed: string[];
  lastError?: { at: number; message: string };
  accountName?: string;
  joinPhrase?: string;
  /** Until when a link code waits for the person's message; absent when none does. */
  linkExpiresAt?: number;
}

export const settingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  accountSid: z.string().trim().max(64).regex(/^(AC[0-9a-fA-F]{32})?$/, "An Account SID starts with AC and has 34 characters").optional(),
  /** Write-only. An empty string keeps the current token. */
  authToken: z.string().trim().max(128).optional(),
  from: z.string().trim().max(40).optional(),
  allowed: z.array(z.string().max(40)).max(MAX_ALLOWED_NUMBERS).optional(),
  joinPhrase: z.string().trim().toLowerCase().max(60).refine((value) => !value || JOIN_PHRASE.test(value), "Paste the sandbox phrase exactly as Twilio shows it, such as join brave-tiger").optional(),
}).strict();

const hashCode = (code: string) => createHash("sha256").update(`whatsapp-link:${code}`).digest("hex");

export type WhatsAppSettingsPatch = z.input<typeof settingsPatchSchema>;

export function createWhatsAppSettings(dataDir: string) {
  const file = join(dataDir, WHATSAPP_FILE);
  const keyFile = join(dataDir, WHATSAPP_KEY_FILE);

  function load(): WhatsAppState {
    try {
      return stateSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      return stateSchema.parse({});
    }
  }

  function save(state: WhatsAppState): void {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  }

  function key(create: boolean): Buffer | null {
    try {
      const hex = readFileSync(keyFile, "utf8").trim();
      if (/^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, "hex");
    } catch {
    }
    if (!create) return null;
    const fresh = randomBytes(32);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    writeFileAtomic(keyFile, `${fresh.toString("hex")}\n`, { mode: 0o600 });
    return fresh;
  }

  function seal(secret: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(true)!, nonce);
    const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64");
  }

  function authToken(state = load()): string {
    const k = state.sealedToken ? key(false) : null;
    if (!k || !state.sealedToken) return "";
    try {
      const data = Buffer.from(state.sealedToken, "base64");
      const decipher = createDecipheriv("aes-256-gcm", k, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(data.length - 16));
      return Buffer.concat([decipher.update(data.subarray(12, data.length - 16)), decipher.final()]).toString("utf8");
    } catch {
      return "";
    }
  }

  function publicSettings(state = load(), now = Date.now()): PublicWhatsAppSettings {
    return {
      enabled: state.enabled,
      accountSid: state.accountSid,
      hasToken: Boolean(authToken(state)),
      from: state.from,
      allowed: state.allowed,
      ...(state.lastError ? { lastError: state.lastError } : {}),
      ...(state.accountName ? { accountName: state.accountName } : {}),
      ...(state.joinPhrase ? { joinPhrase: state.joinPhrase } : {}),
      ...(state.link && state.link.expiresAt > now ? { linkExpiresAt: state.link.expiresAt } : {}),
    };
  }

  function update(patch: WhatsAppSettingsPatch, now = Date.now()): PublicWhatsAppSettings {
    const clean = settingsPatchSchema.parse(patch);
    const state = load();
    if (clean.accountSid !== undefined) state.accountSid = clean.accountSid;
    if (clean.authToken) state.sealedToken = seal(clean.authToken);
    if (clean.from !== undefined) {
      const number = normalizeNumber(clean.from);
      if (clean.from && !number) throw Object.assign(new Error("The WhatsApp sender must be a phone number such as +14155238886"), { status: 400 });
      state.from = number ? `whatsapp:${number}` : SANDBOX_SENDER;
    }
    if (clean.allowed !== undefined) {
      const numbers = clean.allowed.map((raw) => ({ raw, number: normalizeNumber(raw) }));
      const bad = numbers.find((entry) => entry.raw.trim() && !entry.number);
      if (bad) throw Object.assign(new Error(`"${bad.raw.trim()}" is not a phone number. Use the international form, such as +14155550100`), { status: 400 });
      state.allowed = [...new Set(numbers.map((entry) => entry.number).filter(Boolean))];
    }
    if (clean.joinPhrase !== undefined) {
      if (clean.joinPhrase) state.joinPhrase = clean.joinPhrase;
      else delete state.joinPhrase;
    }
    if (clean.accountSid !== undefined || clean.authToken) delete state.accountName;
    if (clean.enabled === true && !state.enabled) state.pollSince = now;
    if (clean.enabled !== undefined) state.enabled = clean.enabled;
    if (state.enabled && (!state.accountSid || !authToken(state) || !state.allowed.length)) {
      throw Object.assign(new Error("Add the Account SID, the auth token and your WhatsApp number before switching WhatsApp on"), { status: 400 });
    }
    delete state.lastError;
    save(state);
    return publicSettings(state);
  }

  /** True the first time a message id is seen; Twilio may deliver the same message twice. */
  function firstSighting(messageSid: string): boolean {
    const state = load();
    if (state.seen.includes(messageSid)) return false;
    state.seen = [...state.seen, messageSid].slice(-SEEN_MAX);
    save(state);
    return true;
  }

  function contact(number: string): WhatsAppContact {
    return load().contacts[number] ?? {};
  }

  function patchContact(number: string, patch: Partial<WhatsAppContact>): void {
    const state = load();
    state.contacts[number] = { ...state.contacts[number], ...patch };
    save(state);
  }

  /** The number whose WhatsApp chat this thread is, if any. */
  function numberForThread(threadId: string): string | null {
    const entry = Object.entries(load().contacts).find(([, value]) => value.threadId === threadId);
    return entry ? entry[0] : null;
  }

  function recordError(message: string, at: number): void {
    const state = load();
    state.lastError = { at, message: message.slice(0, 300) };
    save(state);
  }

  /** The stored token, or `candidate` when one is given: what a check should try. */
  function candidateCredentials(candidate: { accountSid?: string; authToken?: string }): { accountSid: string; authToken: string } {
    const state = load();
    return { accountSid: candidate.accountSid?.trim() || state.accountSid, authToken: candidate.authToken?.trim() || authToken(state) };
  }

  function setAccountName(name: string, now: number): void {
    const state = load();
    state.accountName = name.slice(0, 80);
    state.pollSince ??= now;
    delete state.lastError;
    save(state);
  }

  /** A fresh one-time code; only its hash is kept. While WhatsApp is off, reading restarts now, so nothing older is replayed. */
  function startLink(now: number): { code: string; expiresAt: number } {
    const state = load();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    state.link = { codeHash: hashCode(code), expiresAt: now + LINK_TTL_MS };
    if (!state.enabled || state.pollSince === undefined) state.pollSince = now;
    save(state);
    return { code, expiresAt: state.link.expiresAt };
  }

  function linkPending(now: number, state = load()): boolean {
    return Boolean(state.link && state.link.expiresAt > now);
  }

  /** A live code sent from `number` makes it the owner's and switches WhatsApp on. Single use. */
  function claimLink(code: string, number: string, now: number): boolean {
    const state = load();
    if (!state.link || state.link.expiresAt <= now || !number) return false;
    const expected = Buffer.from(state.link.codeHash, "hex");
    const actual = Buffer.from(hashCode(code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
    delete state.link;
    if (!state.allowed.includes(number)) state.allowed = [...state.allowed, number].slice(-MAX_ALLOWED_NUMBERS);
    state.enabled = Boolean(state.accountSid && authToken(state));
    delete state.lastError;
    save(state);
    return state.enabled;
  }

  function setPollSince(at: number): void {
    const state = load();
    if ((state.pollSince ?? 0) >= at) return;
    state.pollSince = at;
    save(state);
  }

  return {
    load, publicSettings, update, authToken, firstSighting, contact, patchContact, numberForThread, recordError,
    setAccountName, startLink, linkPending, claimLink, setPollSince, candidateCredentials,
  };
}

export type WhatsAppSettings = ReturnType<typeof createWhatsAppSettings>;
