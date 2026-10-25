import type { ServerResponse } from "node:http";

import { isPublicHttps, WHATSAPP_PATH, type WhatsAppChannel } from "../whatsapp/channel.ts";
import { settingsPatchSchema, type WhatsAppSettings } from "../whatsapp/settings.ts";
import { NUMBER_COUNTRIES, type NumberCountry, type NumberKind } from "../whatsapp/numbers.ts";
import { SANDBOX_SENDER, whatsappLink } from "../whatsapp/twilio.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";


/** "+14155550100" as "+1 415 ••• 0100": enough to recognise, not to copy. */
export function maskNumber(number: string): string {
  return number.length > 8 ? `${number.slice(0, 2)} ${number.slice(2, 5)} ••• ${number.slice(-4)}` : "••••";
}

export interface WhatsAppRouteDeps {
  settings: WhatsAppSettings;
  channel: Pick<WhatsAppChannel, "sendTest" | "verify" | "startLink" | "mode" | "findNumbers" | "buyOwnNumber" | "releaseOwnNumber">;
  /** The webhook receiver's public base URL, or its loopback address when it has none. */
  webhookBase(): string;
  teamCloud: boolean;
}

export function createWhatsAppRoutes(deps: WhatsAppRouteDeps): RouteHandler {
  const status = () => {
    const base = deps.webhookBase().replace(/\/+$/, "");
    const settings = deps.settings.publicSettings();
    const sandbox = settings.from === SANDBOX_SENDER;
    return {
      ...settings,
      webhookUrl: `${base}${WHATSAPP_PATH}`,
      reachable: isPublicHttps(base),
      mode: deps.channel.mode(),
      sandbox,
      ...(sandbox && settings.joinPhrase ? { joinUrl: whatsappLink(SANDBOX_SENDER, settings.joinPhrase) } : {}),
      linked: settings.allowed.map(maskNumber),
      available: !deps.teamCloud,
    };
  };
  const failed = (res: ServerResponse, json: RouteContext["json"], error: unknown) => {
    const status = (error as { status?: number }).status ?? ((error as { issues?: unknown }).issues ? 400 : 500);
    const issue = (error as { issues?: Array<{ message?: string }> }).issues?.[0]?.message;
    json(res, status, { error: issue ?? (error as Error).message });
  };

  return async ({ req, res, url, path, method, json, readBody }) => {
    if (path === "/api/whatsapp" && method === "GET") return json(res, 200, status());
    if (path === "/api/whatsapp" && method === "PUT") {
      if (deps.teamCloud) return json(res, 409, { error: "WhatsApp isn't available on a team server yet." });
      try {
        const body = await readBody(req) as Record<string, unknown> | null;
        if (body && ("accountSid" in body || "authToken" in body)) {
          return json(res, 400, { error: "Use Check to change the Twilio account: new credentials are saved only once Twilio accepts them." });
        }
        deps.settings.update(body ?? {});
        return json(res, 200, status());
      } catch (error) {
        return failed(res, json, error);
      }
    }
    if (path === "/api/whatsapp/verify" && method === "POST") {
      if (deps.teamCloud) return json(res, 409, { error: "WhatsApp isn't available on a team server yet." });
      let candidate: { accountSid?: string; authToken?: string };
      try {
        candidate = settingsPatchSchema.pick({ accountSid: true, authToken: true }).strict().parse((await readBody(req)) ?? {});
      } catch (error) {
        return failed(res, json, error);
      }
      const result = await deps.channel.verify(candidate);
      return json(res, result.ok ? 200 : 400, { ...(result.ok ? {} : { error: result.error }), ...status() });
    }
    if (path === "/api/whatsapp/numbers" && method === "GET") {
      if (deps.teamCloud) return json(res, 409, { error: "WhatsApp isn't available on a team server yet." });
      const country = url.searchParams.get("country") ?? "US";
      const kind = url.searchParams.get("kind") === "local" ? "local" : "toll-free";
      if (!(NUMBER_COUNTRIES as readonly string[]).includes(country)) return json(res, 400, { error: "Choose one of the listed countries." });
      const found = await deps.channel.findNumbers(country as NumberCountry, kind);
      return json(res, found.ok ? 200 : 502, found);
    }
    if (path === "/api/whatsapp/number" && method === "POST") {
      if (deps.teamCloud) return json(res, 409, { error: "WhatsApp isn't available on a team server yet." });
      const body = await readBody(req) as Record<string, unknown> | null;
      const country = String(body?.country ?? "");
      const kind = body?.kind === "local" ? "local" : body?.kind === "toll-free" ? "toll-free" : null;
      if (body?.confirm !== true || typeof body.phoneNumber !== "string" || typeof body.confirmedAmount !== "string" || !kind ||
        !(NUMBER_COUNTRIES as readonly string[]).includes(country)) {
        return json(res, 400, { error: "Buying a number needs the number, its country and kind, the price shown, and confirm: true." });
      }
      const base = deps.webhookBase().replace(/\/+$/, "");
      const bought = await deps.channel.buyOwnNumber({
        phoneNumber: body.phoneNumber, country: country as NumberCountry, kind: kind as NumberKind, confirmedAmount: body.confirmedAmount,
        smsUrl: isPublicHttps(base) ? `${base}${WHATSAPP_PATH}` : null,
      });
      return json(res, bought.ok ? 200 : 400, { ...(bought.ok ? {} : { error: bought.error }), ...status() });
    }
    if (path === "/api/whatsapp/number/release" && method === "POST") {
      const body = await readBody(req) as Record<string, unknown> | null;
      if (body?.confirm !== true) return json(res, 400, { error: "Releasing MausBot's number needs confirm: true." });
      const released = await deps.channel.releaseOwnNumber();
      return json(res, released.ok ? 200 : 502, { ...(released.ok ? {} : { error: released.error }), ...status() });
    }
    if (path === "/api/whatsapp/link" && method === "POST") {
      if (deps.teamCloud) return json(res, 409, { error: "WhatsApp isn't available on a team server yet." });
      if (!deps.settings.publicSettings().accountName) return json(res, 409, { error: "Connect your Twilio account first." });
      return json(res, 200, { ...deps.channel.startLink(), ...status() });
    }
    if (path === "/api/whatsapp/test" && method === "POST") {
      if (deps.teamCloud) return json(res, 409, { error: "WhatsApp isn't available on a team server yet." });
      const result = await deps.channel.sendTest();
      return json(res, result.ok ? 200 : 502, { ...result, ...status() });
    }
    return PASS;
  };
}
