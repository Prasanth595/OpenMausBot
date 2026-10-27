import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { compactBudget } from "./context-budget.ts";
import type { BridgeTool } from "./drivers/agents-bridge.ts";
import { childEnv } from "./testing/omb-env.ts";

type McpServer = { command: string; args: string[]; env: Record<string, string> };
type Launched = { pid: number; systemPrompt: string; mcpConfig: { mcpServers: Record<string, McpServer> } };
type Answer = {
  id: number;
  result?: { tools?: BridgeTool[]; content?: Array<{ text: string }>; isError?: boolean };
  error?: { code: number; message: string };
};
type Ask = (method: string, params?: unknown) => Promise<Answer>;

async function withFixture(run: (helpers: {
  api(method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }>;
  control(args: string[]): Promise<Record<string, unknown>>;
  launched(): Promise<Launched>;
}) => Promise<void>) {
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang" });
  try {
    await run({
      api: async (method, path, body) => {
        const response = await fetch(`${fixture.info.url}${path}`, {
          method,
          headers: { "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const json: unknown = await response.json();
        return { status: response.status, body: (json && typeof json === "object" ? json : {}) as Record<string, unknown> };
      },
      control: async (args) => (await runControlOmb([...args, "--url", fixture.info.url])) as Record<string, unknown>,
      launched: async () => {
        await expect.poll(() => existsSync(fixture.fixtureDumpPath), { timeout: 30_000 }).toBe(true);
        const value = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as Launched;
        rmSync(fixture.fixtureDumpPath, { force: true });
        return value;
      },
    });
  } finally {
    await fixture.close();
  }
}

async function withServer(server: McpServer, run: (ask: Ask) => Promise<void>): Promise<void> {
  const child = spawn(server.command, server.args, { env: childEnv(server.env), stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map<number, { resolve(answer: Answer): void; reject(error: Error): void }>();
  let buffer = "";
  let nextId = 1;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const parsed = JSON.parse(line) as Answer;
      const callback = waiting.get(parsed.id);
      if (callback) {
        waiting.delete(parsed.id);
        callback.resolve(parsed);
      }
    }
  });

  const ask: Ask = (method, params = {}) =>
    new Promise<Answer>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });

  try {
    await ask("initialize", { protocolVersion: "2024-11-05" });
    await run(ask);
  } finally {
    child.kill("SIGTERM");
  }
}

describe("token optimization e2e verification", () => {
  it("discovers configured LLM instances and models in OpenMaus", () => withFixture(async ({ api }) => {
    const instancesRes = await api("GET", "/api/instances");
    expect(instancesRes.status).toBe(200);
    const instances = (instancesRes.body.instances as Array<Record<string, unknown>>) || [];
    expect(instances.length).toBeGreaterThan(0);

    console.log("\n=======================================================");
    console.log("       OPENMAUS CONFIGURED LLM PROVIDERS & MODELS       ");
    console.log("=======================================================");
    for (const inst of instances) {
      const models = inst.models as { default?: string; options?: Array<{ id?: string; name?: string } | string> } | undefined;
      const modelList = models?.options?.map((m) => (typeof m === "string" ? m : m.id || m.name || "")) || [];
      console.log(`Provider / Instance : ${inst.instanceId}`);
      console.log(`  Driver Kind       : ${inst.driverKind}`);
      console.log(`  Display Name      : ${inst.displayName}`);
      console.log(`  Default Model     : ${models?.default || "(default)"}`);
      console.log(`  Available Models  : ${modelList.join(", ") || "(none listed)"}`);
      console.log("-------------------------------------------------------");
    }
  }));

  it("measures tool overhead savings between unbridged and bridged turns", () => withFixture(async ({ control, launched, api }) => {
    const { bot } = (await control(["new-bot", "--name", "Measurement Bot"])) as { bot: { id: string } };

    // Turn 1: Unbridged turn
    await control(["send", "--bot", bot.id, "--text", "Start unbridged"]);
    const unbridgedTurn = await launched();
    const unbridgedMcp = unbridgedTurn.mcpConfig.mcpServers.agents!;

    let unbridgedBytes = 0;
    let unbridgedToolsCount = 0;
    await withServer(unbridgedMcp, async (ask) => {
      const list = await ask("tools/list");
      const tools = list.result?.tools || [];
      unbridgedToolsCount = tools.length;
      unbridgedBytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
    });

    await control(["interrupt", "--bot", bot.id]);
    await control(["wait", "--bot", bot.id, "--timeout", "30"]);

    // Turn 2: Bridged turn
    await api("PATCH", "/api/config", { features: { agentsToolBridge: true } });
    await control(["send", "--bot", bot.id, "--text", "Start bridged"]);
    const bridgedTurn = await launched();
    const bridgedMcp = bridgedTurn.mcpConfig.mcpServers.agents!;

    let bridgedBytes = 0;
    let bridgedToolsCount = 0;
    await withServer(bridgedMcp, async (ask) => {
      const list = await ask("tools/list");
      const tools = list.result?.tools || [];
      bridgedToolsCount = tools.length;
      bridgedBytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
    });

    await control(["interrupt", "--bot", bot.id]);
    await control(["wait", "--bot", bot.id, "--timeout", "30"]);

    const unbridgedTokens = Math.ceil(unbridgedBytes / 4);
    const bridgedTokens = Math.ceil(bridgedBytes / 4);
    const savedBytes = unbridgedBytes - bridgedBytes;
    const savedTokens = unbridgedTokens - bridgedTokens;
    const pctSaved = ((savedBytes / unbridgedBytes) * 100).toFixed(1);

    console.log("\n=== TOOL OVERHEAD TOKEN SAVINGS ===");
    console.log(`Unbridged Tool Catalog: ${unbridgedToolsCount} tools | ${unbridgedBytes} bytes | ~${unbridgedTokens} tokens/turn`);
    console.log(`Bridged Tool Catalog:   ${bridgedToolsCount} tools | ${bridgedBytes} bytes | ~${bridgedTokens} tokens/turn`);
    console.log(`Per-Turn Token Savings: ${savedBytes} bytes saved | ~${savedTokens} tokens saved (${pctSaved}% reduction)`);

    expect(bridgedBytes).toBeLessThan(unbridgedBytes / 2);
    expect(bridgedToolsCount).toBeLessThan(unbridgedToolsCount);
  }));

  it("measures context compaction threshold savings on typical LLM context windows", () => {
    const windows = [
      { name: "Claude Sonnet (200k)", window: 200_000 },
      { name: "Gemini Flash (1M)", window: 1_000_000 },
      { name: "GPT-5 / Codex (128k)", window: 128_000 },
    ];

    console.log("\n=== CONTEXT COMPACTION THRESHOLD SAVINGS ===");
    for (const { name, window } of windows) {
      const defaultThreshold = compactBudget(window); // default 0.80
      const optimizedThreshold = compactBudget(window, undefined, undefined, { OMB_COMPACT_RATIO: "0.45" });
      const tokensBeforeCompaction = defaultThreshold - optimizedThreshold;

      console.log(`Model: ${name}`);
      console.log(`  Default Compaction Threshold (80%):   ${defaultThreshold.toLocaleString()} tokens`);
      console.log(`  Optimized Compaction Threshold (45%): ${optimizedThreshold.toLocaleString()} tokens`);
      console.log(`  Tokens Cleared Before Context Decay:   ${tokensBeforeCompaction.toLocaleString()} tokens`);

      expect(optimizedThreshold).toBe(Math.floor(window * 0.45));
    }
  });
});
