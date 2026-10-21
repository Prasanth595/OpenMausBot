// The API-engine tool wire: tools mounted for a turn (computer, browser,
// the user's own MCP servers) must be ADVERTISED to the model in the
// chat-completions body, and a streamed tool_call response — split across
// SSE deltas the way real providers send it — must be reassembled, executed,
// and fed back as role:"tool" messages until the model answers in prose.
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeTool } from "../contracts.ts";
import { recordEvents } from "../testing/events.ts";
import { VisionDriver } from "./vision.ts";

const ECHO_TOOL: RuntimeTool = {
  name: "fake_echo",
  description: "Echo the given text",
  parameters: { type: "object", properties: { echo: { type: "string" } }, required: ["echo"] },
  execute: async (args) => ({ isError: false, text: `echoed: ${String(args?.echo ?? "")}`, images: [] }),
};

interface Toolbox {
  list: RuntimeTool[];
  close(): Promise<void>;
}

/** driveVision: build a Vision instance whose chat/completions calls are
 * scripted by `chat`; /models stays stubbed empty so catalog refresh is inert. */
async function driveVision(chat: (init?: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return chat(init);
    }),
  );
  const inst = await VisionDriver.create({
    instanceId: "test-tools",
    displayName: "Tools",
    enabled: true,
    config: { url: "http://localhost:3001/v1", apiKeyEnv: "TEST_KEY" },
    environment: { TEST_KEY: "secret" },
  });
  return inst;
}

const sse = (chunks: string[]): Response =>
  new Response(chunks.join("") + "data: [DONE]\n", {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
const delta = (payload: unknown): string => `data: ${JSON.stringify({ choices: [{ delta: payload }] })}\n`;

describe("openai-chat tool wire", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("advertises mounted tools and completes a fragmented tool_call round trip", async () => {
    const bodies: any[] = [];
    let closeCount = 0;
    const toolbox: Toolbox = {
      list: [ECHO_TOOL],
      close: async () => {
        closeCount += 1;
      },
    };

    const responses = [
      // Round 1: the model asks for fake_echo, with the arguments split
      // across deltas the way OpenAI-compatible providers stream them.
      sse([
        delta({ tool_calls: [{ index: 0, id: "call_a", function: { name: "fake_echo", arguments: '{"echo":"hel' } }] }),
        delta({ tool_calls: [{ index: 0, function: { arguments: 'lo"}' } }] }),
      ]),
      // Round 2: the model has the tool result and answers in prose.
      sse([delta({ content: "all done" }), `data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n`]),
    ];
    const inst = await driveVision((init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return responses.shift()!;
    });

    const recorder = recordEvents(inst.adapter);
    await inst.adapter.sendTurn({ threadId: "thread-tools", text: "use the tool", model: "auto", tools: toolbox });
    const completed = await recorder.until((event) => event.type === "turn.completed");

    expect(completed).toMatchObject({ ok: true });
    // Round 1: the tool rode the body with its JSON Schema intact.
    expect(bodies[0].tools).toEqual([
      {
        type: "function",
        function: {
          name: "fake_echo",
          description: "Echo the given text",
          parameters: { type: "object", properties: { echo: { type: "string" } }, required: ["echo"] },
        },
      },
    ]);
    // Round 2: the assistant call and its tool result are both in thread.
    const secondMessages = bodies[1].messages;
    const assistantCall = secondMessages.find((message: any) => Array.isArray(message.tool_calls));
    expect(assistantCall.tool_calls).toEqual([
      { id: "call_a", type: "function", function: { name: "fake_echo", arguments: '{"echo":"hello"}' } },
    ]);
    expect(secondMessages.at(-1)).toEqual({ role: "tool", content: "echoed: hello", tool_call_id: "call_a" });
    // The transcript heard about the call and the final prose answer.
    const events = recorder.events;
    expect(events.some((event) => event.type === "item.started" && event.itemType === "tool" && event.title === "fake_echo")).toBe(true);
    expect(events.some((event) => event.type === "item.completed" && event.itemType === "tool" && event.ok === true)).toBe(true);
    expect(events.some((event) => event.type === "item.completed" && event.itemType === "assistant_text" && event.text === "all done")).toBe(true);
    // The runtime, not the caller, closes the toolbox exactly once.
    expect(closeCount).toBe(1);
    recorder.stop();
    await inst.dispose();
  });

  it("keeps parallel calls in index order even when deltas interleave", async () => {
    const bodies: any[] = [];
    const toolbox: Toolbox = {
      list: [ECHO_TOOL],
      close: async () => {},
    };
    const responses = [
      sse([
        delta({ tool_calls: [{ index: 1, id: "call_b", function: { name: "fake_echo", arguments: '{"echo":"b"}' } }] }),
        delta({ tool_calls: [{ index: 0, id: "call_a", function: { name: "fake_echo", arguments: '{"echo":"a"}' } }] }),
      ]),
      sse([delta({ content: "ok" })]),
    ];
    const inst = await driveVision((init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return responses.shift()!;
    });

    const recorder = recordEvents(inst.adapter);
    await inst.adapter.sendTurn({ threadId: "thread-parallel", text: "two calls", model: "auto", tools: toolbox });
    await recorder.until((event) => event.type === "turn.completed");

    const toolMessages = bodies[1].messages.filter((message: any) => message.role === "tool");
    expect(toolMessages).toEqual([
      { role: "tool", content: "echoed: a", tool_call_id: "call_a" },
      { role: "tool", content: "echoed: b", tool_call_id: "call_b" },
    ]);
    recorder.stop();
    await inst.dispose();
  });

  it("collapses oversized argument schemas but keeps the tool advertised and callable", async () => {
    // REA-scale reality: some schemas run to hundreds of KB. Above the 2 KB
    // budget the wire carries a permissive object and a teaching note; the
    // tool name + description still reach the model, and the real server
    // still validates whatever arguments arrive.
    const bigSchema = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 120 }, (_, i) => [`field${i}`, { type: "string", description: "x".repeat(40) }]),
      ),
    };
    const bigTool: RuntimeTool = {
      name: "big_tool",
      description: "Carries a giant schema",
      parameters: bigSchema,
      execute: async () => ({ isError: false, text: "big ok", images: [] }),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bodies: any[] = [];
    const responses = [
      sse([delta({ tool_calls: [{ index: 0, id: "call_big", function: { name: "big_tool", arguments: "{}" } }] })]),
      sse([delta({ content: "big done" })]),
    ];
    const inst = await driveVision((init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return responses.shift()!;
    });

    const recorder = recordEvents(inst.adapter);
    await inst.adapter.sendTurn({
      threadId: "thread-big",
      text: "call it",
      model: "auto",
      tools: { list: [bigTool], close: async () => {} },
    });
    await recorder.until((event) => event.type === "turn.completed");

    const advertised = bodies[0].tools[0].function;
    expect(advertised.parameters).toEqual({ type: "object", properties: {}, additionalProperties: true });
    expect(advertised.description).toContain("argument schema omitted");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("1/1 tool schemas exceeded 2048 bytes"));
    // And the call itself still round-trips with its result.
    expect(bodies[1].messages.some((message: any) => message.role === "tool" && message.content === "big ok")).toBe(true);
    warn.mockRestore();
    recorder.stop();
    await inst.dispose();
  });

  it("sends no tools key at all when the turn mounted none", async () => {
    let sentBody: any = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        if (String(input).endsWith("/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
        sentBody = JSON.parse(String(init?.body));
        return sse([delta({ content: "hi" })]);
      }),
    );
    const inst = await VisionDriver.create({
      instanceId: "test-no-tools",
      displayName: "No tools",
      enabled: true,
      config: { url: "http://localhost:3001/v1", apiKeyEnv: "TEST_KEY" },
      environment: { TEST_KEY: "secret" },
    });

    const recorder = recordEvents(inst.adapter);
    await inst.adapter.sendTurn({ threadId: "thread-none", text: "plain", model: "auto" });
    await recorder.until((event) => event.type === "turn.completed");

    expect("tools" in sentBody).toBe(false);
    recorder.stop();
    await inst.dispose();
  });
});
