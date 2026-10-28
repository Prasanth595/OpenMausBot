// Buying and releasing MausBot's own number in the person's Twilio account. Every call here can spend their money,
// so callers buy only after the person confirmed the price this module reported.
import { normalizeNumber, TWILIO_API_BASE, type TwilioCredentials } from "./twilio.ts";

export const TWILIO_PRICING_BASE = "https://pricing.twilio.com";
export const NUMBER_COUNTRIES = ["US", "CA", "GB", "AU", "IN"] as const;
export type NumberCountry = (typeof NUMBER_COUNTRIES)[number];
export type NumberKind = "local" | "toll-free";

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality?: string;
  region?: string;
  sms: boolean;
  voice: boolean;
}

export interface OwnedNumber {
  sid: string;
  phoneNumber: string;
}

interface Options {
  fetchImpl?: typeof fetch;
  apiBase?: string;
  pricingBase?: string;
}

type Failure = { ok: false; error: string; status?: number };

const auth = (credentials: Pick<TwilioCredentials, "accountSid" | "authToken">) =>
  `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString("base64")}`;

async function call(credentials: Pick<TwilioCredentials, "accountSid" | "authToken">, url: string, init: RequestInit, options: Options): Promise<{ ok: true; json: Record<string, unknown> } | Failure> {
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      ...init,
      headers: { authorization: auth(credentials), ...(init.body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      signal: AbortSignal.timeout(20_000),
    });
    const json = response.status === 204 ? {} : await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok) return { ok: true, json };
    return { ok: false, error: typeof json.message === "string" ? json.message : `Twilio answered ${response.status}`, status: response.status };
  } catch (error) {
    return { ok: false, error: `Could not reach Twilio: ${(error as Error).message}` };
  }
}

const account = (credentials: Pick<TwilioCredentials, "accountSid">, options: Options) =>
  `${options.apiBase ?? TWILIO_API_BASE}/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}`;

/** Numbers that can both text and take calls, so one number serves every way of reaching MausBot. */
export async function searchNumbers(
  credentials: Pick<TwilioCredentials, "accountSid" | "authToken">,
  country: NumberCountry,
  kind: NumberKind,
  options: Options = {},
): Promise<{ ok: true; numbers: AvailableNumber[] } | Failure> {
  const query = new URLSearchParams({ SmsEnabled: "true", VoiceEnabled: "true", PageSize: "10" });
  const path = kind === "toll-free" ? "TollFree" : "Local";
  const result = await call(credentials, `${account(credentials, options)}/AvailablePhoneNumbers/${country}/${path}.json?${query}`, {}, options);
  if (!result.ok) return result;
  const rows = Array.isArray(result.json.available_phone_numbers) ? result.json.available_phone_numbers as Array<Record<string, unknown>> : [];
  const numbers = rows.flatMap((row): AvailableNumber[] => {
    const phoneNumber = normalizeNumber(String(row.phone_number ?? ""));
    if (!phoneNumber) return [];
    const caps = (row.capabilities ?? {}) as Record<string, unknown>;
    return [{
      phoneNumber,
      friendlyName: String(row.friendly_name ?? phoneNumber),
      ...(typeof row.locality === "string" && row.locality ? { locality: row.locality } : {}),
      ...(typeof row.region === "string" && row.region ? { region: row.region } : {}),
      sms: caps.SMS === true || caps.sms === true,
      voice: caps.voice === true || caps.Voice === true,
    }];
  });
  return { ok: true, numbers: numbers.filter((number) => number.sms && number.voice) };
}

/** Twilio's current monthly price for a number of this kind, as it bills the person, e.g. { amount: "2.15", currency: "USD" }. */
export async function monthlyPrice(
  credentials: Pick<TwilioCredentials, "accountSid" | "authToken">,
  country: NumberCountry,
  kind: NumberKind,
  options: Options = {},
): Promise<{ ok: true; amount: string; currency: string } | Failure> {
  const result = await call(credentials, `${options.pricingBase ?? TWILIO_PRICING_BASE}/v1/PhoneNumbers/Countries/${country}`, {}, options);
  if (!result.ok) return result;
  const prices = Array.isArray(result.json.phone_number_prices) ? result.json.phone_number_prices as Array<Record<string, unknown>> : [];
  const wanted = kind === "toll-free" ? "toll free" : "local";
  const price = prices.find((row) => String(row.number_type ?? "").toLowerCase() === wanted);
  const amount = String(price?.current_price ?? price?.base_price ?? "");
  if (!price || !/^\d+(\.\d+)?$/.test(amount)) return { ok: false, error: `Twilio has no ${wanted} number price for ${country}.` };
  return { ok: true, amount, currency: String(result.json.price_unit ?? "USD").toUpperCase() };
}

export async function buyNumber(
  credentials: Pick<TwilioCredentials, "accountSid" | "authToken">,
  phoneNumber: string,
  smsUrl: string | null,
  options: Options = {},
): Promise<{ ok: true; number: OwnedNumber } | Failure> {
  const form = new URLSearchParams({ PhoneNumber: normalizeNumber(phoneNumber), FriendlyName: "MausBot" });
  if (smsUrl) {
    form.set("SmsUrl", smsUrl);
    form.set("SmsMethod", "POST");
  }
  const result = await call(credentials, `${account(credentials, options)}/IncomingPhoneNumbers.json`, { method: "POST", body: form.toString() }, options);
  if (!result.ok) return result;
  const sid = String(result.json.sid ?? "");
  const bought = normalizeNumber(String(result.json.phone_number ?? ""));
  return sid && bought ? { ok: true, number: { sid, phoneNumber: bought } } : { ok: false, error: "Twilio didn't say which number it bought." };
}

/** Points the number's text messages at `smsUrl`, or back at nothing (polling) with null. */
export async function setSmsWebhook(
  credentials: Pick<TwilioCredentials, "accountSid" | "authToken">,
  sid: string,
  smsUrl: string | null,
  options: Options = {},
): Promise<{ ok: true } | Failure> {
  const form = new URLSearchParams({ SmsUrl: smsUrl ?? "", SmsMethod: "POST" });
  const result = await call(credentials, `${account(credentials, options)}/IncomingPhoneNumbers/${encodeURIComponent(sid)}.json`, { method: "POST", body: form.toString() }, options);
  return result.ok ? { ok: true } : result;
}

export async function releaseNumber(
  credentials: Pick<TwilioCredentials, "accountSid" | "authToken">,
  sid: string,
  options: Options = {},
): Promise<{ ok: true } | Failure> {
  const result = await call(credentials, `${account(credentials, options)}/IncomingPhoneNumbers/${encodeURIComponent(sid)}.json`, { method: "DELETE" }, options);
  return result.ok || result.status === 404 ? { ok: true } : result;
}
