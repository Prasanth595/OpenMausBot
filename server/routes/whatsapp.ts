import type { ServerResponse } from "node:http";

import { WHATSAPP_PATH, type WhatsAppChannel } from "../whatsapp/channel.ts";
import type { WhatsAppSettings } from "../whatsapp/settings.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/u;

export interface WhatsAppRouteDeps {
  settings: WhatsAppSettings;
  channel: Pick<WhatsAppChannel, "sendTest">;
  /** The webhook receiver's public base URL, or its loopback address when it has none. */
  webhookBase(): string;
  teamCloud: boolean;
}

export function createWhatsAppRoutes(deps: WhatsAppRouteDeps): RouteHandler {
  const status = () => {
    const base = deps.webhookBase().replace(/\/+$/, "");
    return {
      ...deps.settings.publicSettings(),
      webhookUrl: `${base}${WHATSAPP_PATH}`,
      reachable: !LOOPBACK.test(base),
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
    if (path === "/api/whatsapp/test" && method === "POST") {
      if (deps.teamCloud) return json(res, 409, { error: "WhatsApp isn't available on a team server yet." });
      const result = await deps.channel.sendTest();
      return json(res, result.ok ? 200 : 502, { ...result, ...status() });
    }
    return PASS;
  };
}
