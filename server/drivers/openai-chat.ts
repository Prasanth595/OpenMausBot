import type {
  DriverCreateInput,
  ModelCatalog,
  ProviderInstance,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimeTool,
  SendTurnInput,
} from "../contracts.ts";
import { newEventId, newId } from "../contracts.ts";
import { appendNative } from "./native.ts";
import { classifyError, computeBackoff, interruptibleDelay, RETRY_MAX_ATTEMPTS } from "./retry.ts";

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** Present on assistant messages that request tool calls (tool loop). */
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  /** Present on role:"tool" messages answering one tool_call_id. */
  tool_call_id?: string;
}

interface Usage {
  input: number;
  output: number;
}

interface Completion {
  text: string;
  reasoning: string;
  usage: Usage | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}

interface CompletionJson {
  choices?: Array<{
    message?: AssistantMessageJson;
    delta?: { content?: unknown; reasoning_content?: unknown; tool_calls?: unknown };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** One OpenAI-style function definition advertised in the request body. */
interface OpenAIToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

/** Catalogs like REA's (207 tools, four mega-schemas over 100 KB each) carry
 * more argument schema than any request should: every turn pays it in tokens.
 * Oversized schemas collapse to a permissive object — the tool still validates
 * its own arguments and its structured error is fed back to the model — while
 * every tool keeps its name and full description, which is what selection
 * actually needs. 2 KB keeps even the biggest real catalogs near ~57k tokens.
 */
const TOOL_SCHEMA_BYTE_BUDGET = 2048;
const PERMISSIVE_SCHEMA = { type: "object", properties: {}, additionalProperties: true };
const SCHEMA_OMITTED_NOTE = " (argument schema omitted here for size; pass the arguments the tool expects and it will report what it needs)";
let warnedSchemaCollapse = false;

/** Harness-mounted RuntimeTools, flattened to the wire format the model reads. */
const toolDefinitions = (tools: RuntimeTool[]): OpenAIToolDefinition[] => {
  let collapsed = 0;
  const defs = tools.map((tool) => {
    const parameters = tool.parameters ?? { type: "object", properties: {} };
    let advertised = parameters;
    let description = tool.description ?? "";
    try {
      if (JSON.stringify(parameters).length > TOOL_SCHEMA_BYTE_BUDGET) {
        advertised = PERMISSIVE_SCHEMA;
        description += SCHEMA_OMITTED_NOTE;
        collapsed += 1;
      }
    } catch {
      advertised = PERMISSIVE_SCHEMA; // un-serializable schema must never poison the request
      collapsed += 1;
    }
    return { type: "function" as const, function: { name: tool.name, description, parameters: advertised } };
  });
  if (collapsed > 0 && !warnedSchemaCollapse) {
    warnedSchemaCollapse = true;
    console.warn(
      `api-tools: ${collapsed}/${tools.length} tool schemas exceeded ${TOOL_SCHEMA_BYTE_BUDGET} bytes and were advertised without argument schemas`,
    );
  }
  return defs;
};

/** Streaming providers split one call across deltas: id and name arrive once,
 * arguments arrive as string fragments. Fragments are reassembled by index. */
interface ChatToolCallFragment {
  index?: unknown;
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

interface NativeLog {
  source: string;
  outgoing(turn: SendTurnInput, messages: OpenAIChatMessage[], model: string): unknown;
  incoming(completion: Completion): unknown;
}

interface RuntimeOptions<Config> {
  input: DriverCreateInput<Config>;
  driverKind: string;
  apiKey: string;
  apiUrl: string;
  models: () => ModelCatalog;
  requestBody(model: string, messages: OpenAIChatMessage[], stream: boolean): Record<string, unknown>;
  httpErrorLabel: string;
  missingKeyError: string;
  unavailableReason: string;
  timeoutMs: number;
  nativeLog: NativeLog;
  refreshModels?: () => Promise<void>;
  generateModel?: () => string;
  reasoning?: boolean;
  billing?: "metered";
  includeUsageInCompleted?: boolean;
  noBodyError?: string;
  retryScale?: number;
  /** Capabilities this driver instance can honor. `apiToolLoop` must be
   * true for any tool surface (computer/browser/…) to be advertised: the
   * flags promise only what sendTurn can actually execute. */
  capabilities?: {
    apiToolLoop?: boolean;
    computerMcp?: boolean;
    browserMcp?: boolean;
    localComputerMcp?: boolean;
    phoneMcp?: boolean;
    agentsMcp?: boolean;
    composioMcp?: boolean;
    /** True when the harness toolbox may spawn the user's own MCP servers
     * (config.json mcpServers) for each turn. */
    customMcp?: boolean;
    images?: boolean;
  };
}

const usageFrom = (usage: CompletionJson["usage"]): Usage | null =>
  usage
    ? { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 }
    : null;

/** Normalize an assistant message's tool_calls from a non-streaming response;
 * the streaming path reassembles fragmented tool_call deltas as they arrive. */
interface AssistantToolCallJson {
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}
interface AssistantMessageJson {
  content?: unknown;
  reasoning_content?: unknown;
  tool_calls?: AssistantToolCallJson[];
}
const toolCallsFrom = (message: AssistantMessageJson | undefined): Completion["toolCalls"] =>
  (Array.isArray(message?.tool_calls) ? message!.tool_calls : [])
    .map((call, index) => ({
      id: typeof call?.id === "string" && call.id ? call.id : `call_${index}`,
      name: typeof call?.function?.name === "string" ? call.function.name : "",
      arguments: typeof call?.function?.arguments === "string" ? call.function.arguments : "{}",
    }))
    .filter((call) => call.name);

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value));

/** Shared runtime for the three providers that speak OpenAI chat completions. */
export function createOpenAIChatRuntime<Config>(options: RuntimeOptions<Config>): ProviderInstance {
  const { input } = options;
  const listeners = new Set<RuntimeEventListener>();
  const active = new Map<string, AbortController>();

  const emit = (event: RuntimeEvent) => {
    for (const listener of Array.from(listeners)) listener(event);
  };
  const base = (threadId: string, turnId: string) => ({
    eventId: newEventId(),
    provider: options.driverKind,
    threadId,
    turnId,
    createdAt: new Date().toISOString(),
  });

  const complete = async (
    messages: OpenAIChatMessage[],
    model: string,
    stream: boolean,
    signal?: AbortSignal,
    onDelta?: (delta: string, kind: "assistant_text" | "reasoning_text") => void,
    tools: OpenAIToolDefinition[] = [],
  ): Promise<Completion> => {
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const response = await fetch(`${options.apiUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
      // Advertised tools ride the request body; a turn that mounted no tools
      // sends no `tools` key at all so strict endpoints see the old shape.
      body: JSON.stringify({
        ...options.requestBody(model, messages, stream),
        ...(tools.length > 0 ? { tools } : {}),
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`${options.httpErrorLabel} HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }

    if (!stream) {
      const json = await response.json() as CompletionJson;
      const message = json.choices?.[0]?.message;
      return {
        text: typeof message?.content === "string" ? message.content : "",
        reasoning: options.reasoning && typeof message?.reasoning_content === "string"
          ? message.reasoning_content
          : "",
        usage: usageFrom(json.usage),
        toolCalls: toolCallsFrom(message),
      };
    }

    if (!response.body) {
      throw new Error(options.noBodyError ?? `${options.httpErrorLabel} returned no response body`);
    }
    let text = "";
    let reasoning = "";
    let usage: Usage | null = null;
    // Reassembled tool calls: index -> { id, name, arguments }.
    const toolCallParts = new Map<number, { id: string; name: string; args: string }>();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      readLoop: for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") break readLoop;
          let chunk: CompletionJson;
          try {
            chunk = JSON.parse(data) as CompletionJson;
          } catch {
            continue;
          }
          const delta = chunk.choices?.[0]?.delta;
          const reasoningDelta = options.reasoning && typeof delta?.reasoning_content === "string"
            ? delta.reasoning_content
            : "";
          const contentDelta = typeof delta?.content === "string" ? delta.content : "";
          if (reasoningDelta) {
            reasoning += reasoningDelta;
            onDelta?.(reasoningDelta, "reasoning_text");
          }
          if (contentDelta) {
            text += contentDelta;
            onDelta?.(contentDelta, "assistant_text");
          }
          if (Array.isArray(delta?.tool_calls)) {
            for (const fragment of delta.tool_calls as ChatToolCallFragment[]) {
              if (typeof fragment !== "object" || fragment === null) continue;
              const index = typeof fragment.index === "number" ? fragment.index : 0;
              const part = toolCallParts.get(index) ?? { id: "", name: "", args: "" };
              if (typeof fragment.id === "string" && fragment.id) part.id = fragment.id;
              const name = fragment.function?.name;
              if (typeof name === "string" && name && !part.name) part.name = name;
              const args = fragment.function?.arguments;
              if (typeof args === "string") part.args += args;
              toolCallParts.set(index, part);
            }
          }
          if (chunk.usage) usage = usageFrom(chunk.usage);
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const toolCalls = [...toolCallParts.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, part]) => ({
        id: part.id || `call_${index}`,
        name: part.name,
        arguments: part.args || "{}",
      }))
      .filter((call) => call.name);
    return { text, reasoning, usage, toolCalls };
  };

  const messagesFor = (turn: SendTurnInput): OpenAIChatMessage[] => [
    ...(turn.system ? [{ role: "system" as const, content: turn.system }] : []),
    ...(turn.transcript ?? []).map((message) => ({
      role: message.role,
      content: message.text,
    })),
    { role: "user", content: turn.text },
  ];

  const sendTurn = async (turn: SendTurnInput) => {
    if (!options.apiKey) throw new Error(options.missingKeyError);
    if (active.has(turn.threadId)) throw new Error("a turn is already running on this thread");

    const turnId = newId();
    const abort = new AbortController();
    const messages = messagesFor(turn);
    const model = turn.model || options.models().default;
    active.set(turn.threadId, abort);
    appendNative(turn.threadId, {
      dir: "out",
      source: options.nativeLog.source,
      msg: options.nativeLog.outgoing(turn, messages, model),
    });
    emit({ ...base(turn.threadId, turnId), type: "turn.started" });
    emit({ ...base(turn.threadId, turnId), type: "session.started", sessionId: null, model });

    void (async () => {
      let attempt = 0;
      let streamedText = false;
      // Harness-mounted tools for API engines (computer, browser, …). The
      // loop below is the ONLY consumer; whatever happens, the toolbox is
      // closed exactly once, after the last model round-trip.
      const toolbox = turn.tools;
      const toolDefs = toolbox && toolbox.list.length > 0 ? toolDefinitions(toolbox.list) : [];
      // Calls already executed this turn. A transient failure after one of
      // them must not replay the round that produced it: the provider would
      // see the tool result and could request the same operation again.
      let handledToolCalls = 0;
      try {
        for (;;) {
          try {
            const completion = await complete(messages, model, true, abort.signal, (delta, streamKind) => {
              if (streamKind === "assistant_text") streamedText = true;
              emit({ ...base(turn.threadId, turnId), type: "content.delta", streamKind, delta });
            }, toolDefs);
            appendNative(turn.threadId, {
              dir: "in",
              source: options.nativeLog.source,
              msg: options.nativeLog.incoming(completion),
            });

            // ── the tool loop ────────────────────────────────────
            // The model asked for a tool instead of answering: execute every
            // requested call through the harness executors, feed the results
            // back as tool messages, and take another model round-trip. The
            // reply is only final when the model answers without tool_calls.
            if (toolbox && completion.toolCalls.length > 0) {
              // Emit the assistant's visible text (often narration before
              // the calls) so it lands in the transcript once, not per round.
              if (completion.text.trim()) {
                emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "assistant_text", text: completion.text.trim() });
              }
              messages.push({
                role: "assistant",
                content: completion.text || null,
                ...(completion.toolCalls.length > 0
                  ? {
                      tool_calls: completion.toolCalls.map((call) => ({
                        id: call.id,
                        type: "function" as const,
                        function: { name: call.name, arguments: call.arguments },
                      })),
                    }
                  : {}),
              });
              for (const call of completion.toolCalls) {
                const tool = toolbox.list.find((candidate) => candidate.name === call.name);
                const toolEvent = base(turn.threadId, turnId);
                if (!tool) {
                  emit({ ...toolEvent, type: "item.completed", itemType: "assistant_text", text: `Tool "${call.name}" is not available on this turn.` });
                  messages.push({ role: "tool", content: `Error: unknown tool "${call.name}".`, tool_call_id: call.id });
                  continue;
                }
                let args: Record<string, unknown> = {};
                try {
                  const parsed: unknown = JSON.parse(call.arguments || "{}");
                  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
                } catch {
                  // Malformed arguments reach the tool as empty and the model
                  // sees the tool's own complaint, keeping the loop convergent.
                }
                emit({
                  ...toolEvent,
                  type: "item.started",
                  itemType: "tool",
                  title: call.name,
                  summary: call.name,
                });
                let result: { isError: boolean; text: string; images: Array<{ data: string; mimeType: string }> };
                // Counted before execution: a failed call may still have taken
                // effect, so it forbids a retry just like a successful one.
                handledToolCalls += 1;
                try {
                  result = await tool.execute(args);
                } catch (error) {
                  result = { isError: true, text: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`, images: [] };
                }
                if (result.text || result.images.length === 0) {
                  messages.push({
                    role: "tool",
                    content: result.text || (result.isError ? "Error: the tool failed." : "Done."),
                    tool_call_id: call.id,
                  });
                }
                if (result.images.length > 0) {
                  // Vision-capable models read screenshots as image parts on
                  // a FOLLOWING user message — the OpenAI wire has no image
                  // content on role:"tool". The labeled user message keeps
                  // the turn round-trippable on every OpenAI-compatible
                  // endpoint and the association unambiguous.
                  messages.push({
                    role: "user",
                    content: [
                      { type: "text", text: `Screenshot captured by ${call.name}:` },
                      ...result.images.map((image) => ({
                        type: "image_url",
                        image_url: { url: `data:${image.mimeType};base64,${image.data}` },
                      })),
                    ] as unknown as string,
                  });
                }
                emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "tool", ok: !result.isError });
              }
              continue; // another model round-trip with the results in thread
            }

            const reply = completion.text.trim() ? completion.text : completion.reasoning;
            if (reply.trim()) {
              emit({ ...base(turn.threadId, turnId), type: "item.completed", itemType: "assistant_text", text: reply });
            }
            if (completion.usage) {
              emit({ ...base(turn.threadId, turnId), type: "thread.token-usage.updated", ...completion.usage });
            }
            active.delete(turn.threadId);
            const completed: RuntimeEvent = {
              ...base(turn.threadId, turnId),
              type: "turn.completed",
              ok: true,
              stopReason: null,
              cost: null,
            };
            emit(options.includeUsageInCompleted && completion.usage
              ? { ...completed, usage: completion.usage }
              : completed);
            return;
          } catch (value) {
            const error = asError(value);
            const aborted = error.name === "AbortError";
            const verdict = classifyError(error);
            if (
              options.retryScale !== undefined &&
              !aborted &&
              !streamedText &&
              handledToolCalls === 0 &&
              verdict.transient &&
              attempt < RETRY_MAX_ATTEMPTS - 1
            ) {
              const delayMs = computeBackoff(attempt++);
              emit({
                ...base(turn.threadId, turnId),
                type: "turn.retrying",
                attempt,
                delayMs,
                reason: verdict.reason,
              });
              const outcome = await interruptibleDelay(delayMs * options.retryScale, abort.signal).promise;
              if (outcome === "elapsed" && !abort.signal.aborted) continue;
              active.delete(turn.threadId);
              emit({ ...base(turn.threadId, turnId), type: "turn.completed", ok: false, stopReason: "interrupted", cost: null });
              return;
            }
            active.delete(turn.threadId);
            if (!aborted) emit({ ...base(turn.threadId, turnId), type: "runtime.error", message: error.message });
            emit({
              ...base(turn.threadId, turnId),
              type: "turn.completed",
              ok: false,
              stopReason: aborted ? "interrupted" : "error",
              cost: null,
            });
            return;
          }
        }
      } finally {
        if (toolbox) await toolbox.close().catch(() => {});
      }
    })();
    return { turnId };
  };

  return {
    instanceId: input.instanceId,
    driverKind: options.driverKind,
    displayName: input.displayName,
    enabled: input.enabled,
    get models() {
      return options.models();
    },
    ...(options.refreshModels ? { refreshModels: options.refreshModels } : {}),
    snapshot: async () => options.apiKey
      ? { state: "available", authenticated: true, version: null, ...(options.billing ? { billing: options.billing } : {}) }
      : { state: "unavailable", reason: options.unavailableReason },
    adapter: {
      provider: options.driverKind,
      capabilities: {
        sessionModelSwitch: "in-session" as const,
        ...(options.capabilities?.apiToolLoop
          ? {
              apiToolLoop: true,
              ...(options.capabilities.computerMcp ? { computerMcp: true } : {}),
              ...(options.capabilities.browserMcp ? { browserMcp: true } : {}),
              ...(options.capabilities.localComputerMcp ? { localComputerMcp: true } : {}),
              ...(options.capabilities.phoneMcp ? { phoneMcp: true } : {}),
              ...(options.capabilities.agentsMcp ? { agentsMcp: true } : {}),
              ...(options.capabilities.composioMcp ? { composioMcp: true } : {}),
              ...(options.capabilities.customMcp ? { customMcp: true } : {}),
            }
          : {}),
        ...(options.capabilities?.images ? { images: true } : {}),
      },
      sendTurn,
      interruptTurn: async (threadId) => active.get(threadId)?.abort(),
      respondToRequest: async () => "unavailable" as const,
      hasSession: (threadId) => active.has(threadId),
      stopAll: async () => {
        for (const abort of active.values()) abort.abort();
      },
      onEvent: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    generateText: async (prompt) => {
      const model = options.generateModel?.() ?? options.models().default;
      const { text, reasoning } = await complete([{ role: "user", content: prompt }], model, false);
      return text.trim() ? text : reasoning;
    },
    dispose: async () => {
      for (const abort of active.values()) abort.abort();
      listeners.clear();
    },
  };
}
