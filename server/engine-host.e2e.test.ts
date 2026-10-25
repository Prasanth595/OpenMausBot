import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";

const engineId = "remote-fixture";
const testing = (name: string) => fileURLToPath(new URL(`./testing/${name}`, import.meta.url));

interface Receipt { method: string; pid: number; sessionCwd?: string; servers?: Array<{ name: string; type: string; url?: string }>;
  probes?: Array<{ name: string; status: number | string }>; botsStatus?: number | string }

/** Starts the server with a customAcp instance that runs on `pi-test` (the fake ssh), and returns what the fake agent saw. */
async function runTurnOnHost(options: { localRoot: (dataDir: string) => string; dropAfterMs?: number }) {
  const fixture = await launchVerificationServer();
  const { dataDir, url, logPath } = fixture.info;
  const remoteDir = join(dataDir, "remote-fixture");
  const remoteRoot = join(dataDir, "remote-root");
  const sshLog = join(dataDir, "fake-ssh.jsonl");
  mkdirSync(remoteDir, { recursive: true });
  mkdirSync(join(dataDir, "task-workspaces"), { recursive: true });
  // The shared filesystem: the host sees the harness's workspaces under its own root.
  symlinkSync(join(dataDir, "task-workspaces"), remoteRoot);
  const fakeBin = join(dataDir, "fake-bin");
  mkdirSync(fakeBin);
  symlinkSync(testing("fake-ssh.mjs"), join(fakeBin, "ssh"));
  const internalPort = 19000 + Math.floor(Math.random() * 500);
  let server: ChildProcess | undefined;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, { method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  const receipts = (): Receipt[] => {
    const path = join(remoteDir, "receipts.jsonl");
    return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Receipt) : [];
  };
  try {
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { instances: Record<string, unknown> };
    config.instances[engineId] = { driver: "customAcp", displayName: "Remote fixture",
      config: { cli: `${JSON.stringify(process.execPath)} --experimental-strip-types ${JSON.stringify(testing("fake-remote-acp.ts"))}`,
        host: { alias: "pi-test", workspace: { local: options.localRoot(dataDir), remote: remoteRoot }, remotePortBase: 19600 } },
      environment: { FAKE_REMOTE_DIR: remoteDir, ...(options.dropAfterMs ? { FAKE_REMOTE_HOLD_MS: "30000" } : {}) } };
    writeFileSync(configPath, JSON.stringify(config));
    const log = openSync(logPath, "a", 0o600);
    server = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: ["ignore", log, log],
      env: { ...verificationServerEnvironment({}, dataDir, Number(new URL(url).port)),
        PATH: [fakeBin, dirname(process.execPath)].join(":"), OMB_ENGINE_HOST_PORT: String(internalPort), FAKE_SSH_LOG: sshLog,
        ...(options.dropAfterMs ? { FAKE_SSH_DIE_AFTER_MS: String(options.dropAfterMs) } : {}) },
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
    }, { timeout: 25_000 }).toBe(true);

    const bot = (await api("POST", "/api/bots", { name: "Remote", modelSelection: { instanceId: engineId, model: "agent-default" } })).body.bot as { id: string; threadId: string };
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "go", threadId: bot.threadId })).status).toBe(202);
    await expect.poll(async () => ((await api("GET", "/api/bots")).body.bots as Array<{ id: string; busy: boolean }>).find((entry) => entry.id === bot.id)?.busy, { timeout: 40_000 }).toBe(false);
    const thread = JSON.stringify((await api("GET", `/api/threads/${bot.threadId}/messages?limit=30`)).body);
    const ssh = existsSync(sshLog) ? readFileSync(sshLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { alias: string; forward: string; command: string }) : [];
    const seen = receipts();
    await waitForExit(server, { signal: "SIGTERM" });
    server = undefined;
    return { seen, ssh, thread, remoteRoot, internalPort };
  } finally {
    if (server) await waitForExit(server, { signal: "SIGTERM" });
    await fixture.close();
  }
}

it("runs the engine over ssh in the mapped folder, hands it HTTP tools on the forwarded port, and keeps the front door shut", async () => {
  const run = await runTurnOnHost({ localRoot: (dataDir) => join(dataDir, "task-workspaces") });
  expect(run.ssh).toHaveLength(1);
  const [ssh] = run.ssh;
  expect(ssh!.alias).toBe("pi-test");
  expect(ssh!.forward).toMatch(new RegExp(`^127\\.0\\.0\\.1:196\\d\\d:127\\.0\\.0\\.1:${run.internalPort}$`));
  expect(ssh!.command).toContain(`cd '${run.remoteRoot}/`);
  const created = run.seen.find((entry) => entry.method === "session/new")!;
  expect(created.sessionCwd!.startsWith(`${run.remoteRoot}/`)).toBe(true);
  expect(created.servers!.length).toBeGreaterThan(0);
  for (const server of created.servers!) {
    expect(server.type, server.name).toBe("http");
    expect(server.url, server.name).toMatch(/^http:\/\/127\.0\.0\.1:196\d\d\/api\/internal\/mcp-http\//);
  }
  const prompted = run.seen.find((entry) => entry.method === "session/prompt")!;
  for (const probe of prompted.probes!) expect(probe.status, probe.name).toBe(200);
  expect(prompted.botsStatus).toBe(404);
  expect(run.thread).toContain("remote-ok");
  // Stopping the harness ends the ssh client, so the host's engine sees EOF and exits.
  await expect.poll(() => { try { process.kill(prompted.pid, 0); return true; } catch { return false; } }, { timeout: 8_000 }).toBe(false);
});

it("ends the turn with a setup error, and starts no engine, when the folder has no counterpart on the host", async () => {
  const run = await runTurnOnHost({ localRoot: (dataDir) => join(dataDir, "elsewhere") });
  expect(run.ssh).toHaveLength(0);
  expect(run.seen).toHaveLength(0);
  expect(run.thread).toContain("is outside");
});

it("fails the turn with a host-lost reason, and leaves the harness up, when the ssh connection drops mid-turn", async () => {
  const run = await runTurnOnHost({ localRoot: (dataDir) => join(dataDir, "task-workspaces"), dropAfterMs: 2_000 });
  expect(run.thread).toContain("engine host pi-test lost (ssh exited 255)");
});
