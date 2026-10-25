import type { ServerResponse } from "node:http";

import { WHATSAPP_PATH, type WhatsAppChannel } from "../whatsapp/channel.ts";
import type { WhatsAppSettings } from "../whatsapp/settings.ts";
import { SANDBOX_SENDER, whatsappLink } from "../whatsapp/twilio.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/u;

/** "+14155550100" as "+1 415 ••• 0100": enough to recognise, not to copy. */
export function maskNumber(number: string): string {
  return number.length > 8 ? `${number.slice(0, 2)} ${number.slice(2, 5)} ••• ${number.slice(-4)}` : "••••";
}

export interface WhatsAppRouteDeps {
  settings: WhatsAppSettings;
  channel: Pick<WhatsAppChannel, "sendTest" | "verify" | "startLink" | "mode">;
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
      reachable: !LOOPBACK.test(base),
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

  return async ({ req, res, path, method, json, readBody }) => {
    if (path === "/api/whatsapp" && method === "GET") return json(res, 200, status());
    if (path === "/api/whatsapp" && method === "PUT") {
      if (deps.teamCloud) return json(res, 409, { error: "WhatsApp isn't available on a team server yet." });
      try {
        deps.settings.update(await readBody(req));
        return json(res, 200, status());
      } catch (error) {
        return failed(res, json, error);
      }
    }
    if (path === "/api/whatsapp/verify" && method === "POST") {
      if (deps.teamCloud) return json(res, 409, { error: "WhatsApp isn't available on a team server yet." });
      try {
        const body = await readBody(req) as { accountSid?: unknown; authToken?: unknown };
        deps.settings.update({
          ...(typeof body?.accountSid === "string" ? { accountSid: body.accountSid } : {}),
          ...(typeof body?.authToken === "string" ? { authToken: body.authToken } : {}),
        });
      } catch (error) {
        return failed(res, json, error);
      }
      const result = await deps.channel.verify();
      return json(res, result.ok ? 200 : 400, { ...(result.ok ? {} : { error: result.error }), ...status() });
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
