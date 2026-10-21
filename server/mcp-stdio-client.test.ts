// Unit tests for the API-engine tool bridge: the MCP stdio client
// (server/mcp-stdio-client.ts) and the per-turn toolbox builder
// (server/api-toolbox.ts), exercised against a real child process running
// the fake MCP server (server/testing/fake-mcp-server.mjs).
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildApiToolbox } from "./api-toolbox.ts";
import { McpStdioClient } from "./mcp-stdio-client.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const FAKE = join(import.meta.dirname, "testing", "fake-mcp-server.mjs");

const SERVER_TOOLS = [
  { name: "computer_screenshot", description: "Take a screenshot", inputSchema: { type: "object", properties: {} } },
  { name: "computer_click", description: "Click the mouse", inputSchema: { type: "object", properties: { x: { type: "number" } } } },
];

/** Spec pointing the client at the fake server with the given mode/tools. */
function spec(mode: string, extraEnv: Record<string, string> = {}): { command: string; args: string[]; env: Record<string, string> } {
  return { command: process.execPath, args: [FAKE], env: { FAKE_MCP_MODE: mode, ...extraEnv } };
}

const spawned: ChildProcess[] = [];
afterEach(() => {
  for (const child of spawned.splice(0)) {
    try {
      child.kill();
    } catch {
      // already dead
    }
  }
});

/** Spawn the fake server directly (for tests that probe raw failure modes). */
function spawnFake(mode: string): ChildProcess {
  const child = spawn(process.execPath, [FAKE], { stdio: "pipe", env: { ...process.env, FAKE_MCP_MODE: mode } });
  spawned.push(child);
  return child;
}

describe("McpStdioClient", () => {
  it("completes the handshake, lists tools, and executes a call", async () => {
    const client = await McpStdioClient.start(spec("ok", { FAKE_MCP_TOOLS: JSON.stringify(SERVER_TOOLS) }));
    const listed = await client.listTools();
    expect(listed.map((tool) => tool.name)).toEqual(["computer_screenshot", "computer_click"]);
    // The advertised schema is part of the contract the runtime forwards to
    // the model — it must survive the list normalization intact.
    expect(listed[1]!.inputSchema).toEqual({ type: "object", properties: { x: { type: "number" } } });
    const result = await client.callTool("computer_screenshot", { echo: "hello" });
    expect(result).toMatchObject({ isError: false, text: "hello" });
    await client.close();
  });

  it("normalizes image content blocks into images", async () => {
    const client = await McpStdioClient.start(spec("ok", { FAKE_MCP_TOOLS: JSON.stringify(SERVER_TOOLS) }));
    const result = await client.callTool("computer_screenshot", { mode: "image" });
    expect(result.isError).toBe(false);
    expect(result.text).toBe("screenshot taken");
    expect(result.images).toEqual([{ data: "aWNvbg==", mimeType: "image/png" }]);
    await client.close();
  });

  it("surfaces isError results as data, not thrown errors", async () => {
    const client = await McpStdioClient.start(spec("ok", { FAKE_MCP_TOOLS: JSON.stringify(SERVER_TOOLS) }));
    const result = await client.callTool("computer_screenshot", { mode: "error", text: "screen locked" });
    expect(result).toMatchObject({ isError: true, text: "screen locked" });
    await client.close();
  });

  it("times out a server that never answers", async () => {
    const client = await McpStdioClient.start(spec("silent"));
    // A short client-side timeout keeps the test well under vitest's limit;
    // the error text is the production message the model would see.
    await expect(client.callTool("computer_screenshot", {}, 300)).rejects.toThrow(/timed out/i);
    await client.close();
  });

  it("fails fast when the server dies before the handshake", async () => {
    await expect(McpStdioClient.start(spec("exit-immediately"))).rejects.toThrow();
    // The raw process exits on its own; nothing to clean up beyond the guard.
    spawnFake("exit-immediately");
  });

  // npm's CLIs ship as `npx.cmd`, a batch shim Node cannot execute directly.
  // The mount has to survive that, or every npx-based MCP server — REA among
  // them — silently contributes no tools on Windows.
  it.skipIf(process.platform !== "win32")("mounts a server behind a .cmd batch shim", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-mcp-shim-"));
    try {
      // The shape npm 7+ writes: the script is bound to a variable and the
      // shim runs it through node.
      copyFileSync(FAKE, join(dir, "fake-mcp.mjs"));
      const shim = join(dir, "fake-mcp.cmd");
      writeFileSync(
        shim,
        [
          "@ECHO OFF",
          "SETLOCAL",
          'SET "NODE_EXE=%~dp0\\node.exe"',
          'IF NOT EXIST "%NODE_EXE%" (',
          '  SET "NODE_EXE=node"',
          ")",
          'SET "FAKE_JS=%~dp0\\fake-mcp.mjs"',
          '"%NODE_EXE%" "%FAKE_JS%" %*',
          "",
        ].join("\r\n"),
        "utf8",
      );
      const client = await McpStdioClient.start({
        command: shim,
        args: [],
        env: { FAKE_MCP_MODE: "ok", FAKE_MCP_TOOLS: JSON.stringify(SERVER_TOOLS) },
      });
      const listed = await client.listTools();
      expect(listed.map((tool) => tool.name)).toEqual(["computer_screenshot", "computer_click"]);
      const result = await client.callTool("computer_screenshot", { echo: "through cmd" });
      expect(result).toMatchObject({ isError: false, text: "through cmd" });
      await client.close();
    } finally {
      await removeTempDir(dir);
    }
  });
});

describe("buildApiToolbox", () => {
  it("exposes every listed tool as a ready executor", async () => {
    const toolbox = await buildApiToolbox({
      localComputer: spec("ok", { FAKE_MCP_TOOLS: JSON.stringify(SERVER_TOOLS) }),
    });
    try {
      expect(toolbox.tools.map((tool) => tool.name)).toEqual(["computer_screenshot", "computer_click"]);
      expect(toolbox.toolListProblems).toEqual([]);
      expect(toolbox.tools[0]!.parameters).toEqual({ type: "object", properties: {} });
      expect(toolbox.tools[1]!.parameters).toEqual({ type: "object", properties: { x: { type: "number" } } });
      const result = await toolbox.tools[1]!.execute({ x: 5, echo: "clicked" });
      expect(result).toMatchObject({ isError: false, text: "clicked" });
    } finally {
      await toolbox.close();
    }
  });

  it("degrades one broken mount without losing the others", async () => {
    const toolbox = await buildApiToolbox({
      browser: spec("exit-immediately"), // spawn fails
      localComputer: spec("ok", { FAKE_MCP_TOOLS: JSON.stringify([SERVER_TOOLS[0]]) }),
    });
    try {
      expect(toolbox.tools.map((tool) => tool.name)).toEqual(["computer_screenshot"]);
      expect(toolbox.toolListProblems.length).toBe(1);
      expect(toolbox.toolListProblems[0]).toContain("browser:");
    } finally {
      await toolbox.close();
    }
  });

  it("reports a mount that lists no tools", async () => {
    const toolbox = await buildApiToolbox({ phone: spec("no-tools") });
    try {
      expect(toolbox.tools).toEqual([]);
      expect(toolbox.toolListProblems[0]).toContain("phone:");
    } finally {
      await toolbox.close();
    }
  });

  it("closes every spawned client exactly once", async () => {
    const toolbox = await buildApiToolbox({
      localComputer: spec("ok", { FAKE_MCP_TOOLS: JSON.stringify([SERVER_TOOLS[0]]) }),
      browser: spec("ok", { FAKE_MCP_TOOLS: JSON.stringify([SERVER_TOOLS[1]]) }),
    });
    // Each fake client exits on stdin close; closing twice must be safe.
    await toolbox.close();
    await toolbox.close();
  });
});

// The spawn-failure probe only needs the process to have been launchable.
void spawnFake;
