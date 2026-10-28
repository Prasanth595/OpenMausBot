import { api } from "@/state/store";

import type { NativeAppConnection } from "./connector-status";
import { highLevelConnected, preloadHighLevelStatus } from "./highlevel-status";
import { isWhopServer } from "./whop-integration";
import { isXConnectorStatus } from "../../shared/x-connector";

interface McpServerSummary {
  name: string;
  type?: string;
  url?: string;
  enabled?: boolean;
  auth?: "signed-in" | "needs-sign-in";
}

/** One answer per native card. A failed request counts as not connected, so the caller keeps the pill rather than
 *  hiding it on an answer it never received. */
export async function loadNativeAppConnections(): Promise<NativeAppConnection[]> {
  const [whop, highLevel, x] = await Promise.all([
    api("/api/mcp/servers")
      .then((result: { servers?: McpServerSummary[] }) => {
        const server = (result.servers ?? []).find((entry) => isWhopServer(entry));
        return Boolean(server?.enabled && server.auth === "signed-in");
      })
      .catch(() => false),
    preloadHighLevelStatus()
      .then((status) => highLevelConnected(status))
      .catch(() => false),
    api("/api/x/status")
      .then((status: unknown) => (isXConnectorStatus(status) ? status.using !== null : false))
      .catch(() => false),
  ]);
  return [
    { slug: "whop", connected: whop },
    { slug: "highlevel", connected: highLevel },
    { slug: "x", connected: x },
  ];
}
