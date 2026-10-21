// API-engine tools end to end: boots the real harness with a `vision`
// instance against an in-test freellmapi stub AND a config.json
// `mcpServers` entry pointing at the fake MCP server (a real child process).
// The upstream stub scripts one round of fragmented tool_call deltas, then
// verifies the second round carries the executed tool result back.
//
// This is the proof the fork's tool wire actually works: tools advertised in
// the request body, streamed tool_call fragments reassembled, the MCP tool
// executed by the harness, and role:"tool" messages fed back to the model.
// Windows-safe: no shebang scripts, temp home, random port.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_MCP = join(SERVER_DIR, "testing", "fake-mcp-server.mjs");
const PORT = 19800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;

const MCP_TOOLS = [
  {
    name: "fake_echo",
    description: "Echo the given text",
    inputSchema: { type: "object", properties: { echo: { type: "string" } }, required: ["echo"] },
  },
];

interface UpstreamBody {
  model: string;
  messages: Array<{ role: string; content: unknown; tool_calls?: unknown; tool_call_id?: string }>;
  tools?: unknown;
}

/** The freellmapi stub: fragmented tool_call on round 1, prose on round 2. */
function startUpstream() {
  const bodies: UpstreamBody[] = [];
  const delta = (payload: unknown) => `data: ${JSON.stringify({ choices: [{ delta: payload }] })}\n`;
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "auto", name: "Auto" }] }));
      return;
    }
    if (url.endsWith("/chat/completions") && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw) as UpstreamBody;
        bodies.push(body);
        const answered = body.messages.some((message) => message.role === "tool");
        res.writeHead(200, { "content-type": "text/event-stream" });
        if (!answered) {
          // One call to fake_echo, arguments split across deltas the way
          // OpenAI-compatible providers stream them.
          res.write(delta({ tool_calls: [{ index: 0, id: "call_e2e", function: { name: "fake_echo", arguments: '{"echo":"round-' } }] }));
          res.write(delta({ tool_calls: [{ index: 0, function: { arguments: 'trip"}' } }] }));
        } else {
          res.write(delta({ content: "the tool said: round-trip" }));
        }
        res.end("data: [DONE]\n");
      });
      return;
    }
    res.writeHead(404).end();
  });
  return {
    bodies,
    listen: () => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)),
    get url() {
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("upstream not listening");
      return `http://127.0.0.1:${addr.port}/v1`;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("vision api tools e2e (fake freellmapi + fake MCP)", () => {
  let child: ChildProcess;
  let home: string;
  let stderr = "";
  let upstream: ReturnType<typeof startUpstream>;

  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  const getBot = async (id: string) => (await api("GET", "/api/bots")).body.bots.find((b: any) => b.id === id);

  const waitFor = async (predicate: () => Promise<boolean>, what: string, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. stderr: ${stderr.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  beforeAll(async () => {
    upstream = startUpstream();
    await upstream.listen();

    home = mkdtempSync(join(tmpdir(), "omb-api-tools-"));
    mkdirSync(join(home, ".openmausbot"), { recursive: true });
    writeFileSync(
      join(home, ".openmausbot", "config.json"),
      JSON.stringify({
        instances: {
          vision: {
            driver: "vision",
            environment: { FREELLMAPI_API_KEY: "e2e-key" },
            config: { url: upstream.url, apiKeyEnv: "FREELLMAPI_API_KEY" },
          },
        },
        mcpServers: {
          fake: {
            command: process.execPath,
            args: [FAKE_MCP],
            env: { FAKE_MCP_TOOLS: JSON.stringify(MCP_TOOLS) },
          },
        },
      }),
    );

    const env: NodeJS.ProcessEnv = {
      HOME: home,
      USERPROFILE: home,
      OMB_PORT: String(PORT),
    };
    if (process.env.PATH) env.PATH = process.env.PATH;
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (c) => (stderr += c));

    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const res = await fetch(`${BASE}/api/health`);
        if (res.ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 90_000);

  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await upstream.close();
    await removeTempDir(home);
  });

  it("advertises the custom MCP tool, executes the streamed call, and returns the result", async () => {
    const created = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${created.id}`, {
      modelSelection: { instanceId: "vision", model: "auto" },
    });

    expect((await api("POST", `/api/bots/${created.id}/messages`, { text: "Use the echo tool." })).status).toBe(202);
    await waitFor(async () => {
      const b = await getBot(created.id);
      return (
        !b.busy &&
        b.messages.some(
          (m: { role: string; kind: string; text?: string }) =>
            m.role === "bot" && m.kind === "text" && m.text === "the tool said: round-trip",
        )
      );
    }, "the tool result to come back as prose");

    // Round 1 advertised the user's MCP tool with its schema intact; round 2
    // carried the executed result back as a role:"tool" message. Exactly two
    // upstream calls: no retry/duplicate despite the tool having executed.
    expect(upstream.bodies.length).toBe(2);
    const first = upstream.bodies[0]!;
    expect(first.tools).toEqual([
      {
        type: "function",
        function: {
          name: "fake_echo",
          description: "Echo the given text",
          parameters: MCP_TOOLS[0]!.inputSchema,
        },
      },
    ]);
    const second = upstream.bodies[1]!;
    const assistantCall = second.messages.find((message) => Array.isArray(message.tool_calls));
    expect(assistantCall?.tool_calls).toEqual([
      { id: "call_e2e", type: "function", function: { name: "fake_echo", arguments: '{"echo":"round-trip"}' } },
    ]);
    const toolMessage = second.messages.find((message) => message.role === "tool");
    expect(toolMessage).toMatchObject({ content: "round-trip", tool_call_id: "call_e2e" });
    // The mount listed cleanly — no api-tools degradation warnings.
    expect(stderr).not.toContain("api-tools:");
  }, 60_000);
});
