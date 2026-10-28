import { describe, expect, it } from "vitest";

import type { ToolCallContext } from "./agents-call.ts";
import { callWaitTool, WAIT_TOOL_DEFINITIONS, WAIT_TOOL_NAMES } from "./agents-wait-tools.ts";
import { WAIT_KINDS } from "../../shared/waits.ts";

type Reply = { ok: boolean; status: number; body: Record<string, unknown> };

function setup(reply: Reply = { ok: true, status: 200, body: { text: "ok" } }) {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const client = { apiResponse: async (path: string, init?: RequestInit) => { calls.push([path, init]); return reply; } };
  return { calls, context: { botId: "scout", threadId: "t1", client } as unknown as ToolCallContext };
}

describe("wait tools", () => {
  it("sends wait_until's arguments unchanged to the waits route and returns its words", async () => {
    const { calls, context } = setup({ ok: true, status: 201, body: { text: "Waiting for the build (wait id w1)…" } });
    expect(await callWaitTool("wait_until", { label: "the build", kind: "file_exists", path: "/r" }, context)).toEqual({ text: "Waiting for the build (wait id w1)…" });
    expect(calls).toEqual([["/api/internal/waits", { method: "POST", body: JSON.stringify({ label: "the build", kind: "file_exists", path: "/r" }) }]]);
  });

  it("marks a refusal as an error in the route's words", async () => {
    const { context } = setup({ ok: false, status: 403, body: { error: "Only the person can set up or stop a wait…" } });
    expect(await callWaitTool("wait_until", {}, context)).toEqual({ text: "Only the person can set up or stop a wait…", isError: true });
  });

  it("lists with a GET and cancels by id", async () => {
    const { calls, context } = setup();
    await callWaitTool("list_waits", {}, context);
    await callWaitTool("cancel_wait", { id: "w1" }, context);
    expect(calls).toEqual([["/api/internal/waits", undefined], ["/api/internal/waits/cancel", { method: "POST", body: '{"id":"w1"}' }]]);
  });

  it("defines the three tools in order, with follow_up and never then", () => {
    expect(WAIT_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(["wait_until", "list_waits", "cancel_wait"]);
    expect([...WAIT_TOOL_NAMES]).toEqual(["wait_until", "list_waits", "cancel_wait"]);
    const waitUntil = WAIT_TOOL_DEFINITIONS.find((tool) => tool.name === "wait_until")!;
    const properties = (waitUntil.inputSchema as unknown as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(Object.keys(properties)).toEqual(["label", "kind", "url", "text", "path", "process", "bot", "follow_up", "hours"]);
    expect(properties.kind!.enum).toEqual([...WAIT_KINDS]);
    expect(JSON.stringify(WAIT_TOOL_DEFINITIONS)).not.toMatch(/"then"|with then|give then/);
    expect(waitUntil.description).toContain("with follow_up, you also carry out follow_up here");
  });
});
