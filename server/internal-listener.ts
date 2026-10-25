// Security invariant: this listener serves /api/internal/* only, for a caller that presents a per-turn capability bearer,
// and request-auth never gives a request that arrived here owner trust. An engine on another machine reaches it through
// `ssh -R`, whose connections look like loopback to the harness.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { harnessPathAllowed } from "./bot-box/harness-gate.ts";

export const internalListenerRequests = new WeakSet<IncomingMessage>();

type Handler = (req: IncomingMessage, res: ServerResponse) => unknown;

function refuse(res: ServerResponse, status: 401 | 404, error: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ error }));
}

export function createInternalListener(handle: Handler): Server {
  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0]!;
    if (!harnessPathAllowed(path)) return refuse(res, 404, "not_an_internal_route");
    const header = req.headers.authorization;
    const token = typeof header === "string" ? /^Bearer\s+(\S+)$/i.exec(header)?.[1] : undefined;
    // A paired device's session token must never ride this listener.
    if (!token || token.startsWith("omb_sess_")) return refuse(res, 401, "unauthorized");
    delete req.headers.cookie;
    internalListenerRequests.add(req);
    return void handle(req, res);
  });
  server.on("upgrade", (_req, socket) => socket.destroy());
  return server;
}
