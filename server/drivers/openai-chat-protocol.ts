// Structured chat-completions calls. Assistant content is never parsed as a tool.
export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Calls one model reply may carry (its index bound). */
const MAX_REPLY_TOOL_CALLS = 32;
const MAX_ARGUMENT_CHARS = 256_000;

/** Reasoning a single reply may carry before the turn is refused. Counted on each block's own text.
 * OpenAI-compatible gateways repeat a fixed JSON envelope on every streamed delta: measured against
 * openrouter/glm-5.3-flash, JSON.stringify of the deltas cost 8.9x the reasoning itself, so counting the
 * envelope capped a turn at ~30 KB of real reasoning and killed it mid-stream. */
const MAX_REASONING_CHARS = 400_000;
/** Blocks one reply may carry: reasoning arrives a block per delta, so this is the other half of the bound. */
const MAX_REASONING_BLOCKS = 20_000;

export class ChatProtocolError extends Error {}

export function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** The reasoning itself: `text` blocks carry prose, `encrypted` blocks carry opaque data, and only their own
 * bytes are the turn's cost. Another block shape is measured as the JSON it arrived as. */
function reasoningPayloadLength(block: Record<string, unknown>): number {
  for (const field of ["text", "data"]) {
    const value = block[field];
    if (typeof value === "string") return value.length;
  }
  return JSON.stringify(block).length;
}

/** Opaque provider reasoning blocks must keep their original order/signatures.
 * OpenRouter streams the sequence as arrays of blocks, not tool-call deltas. */
export class ChatReasoningDetails {
  readonly blocks: Record<string, unknown>[] = [];
  private chars = 0;

  add(value: unknown): void {
    if (value === undefined || value === null) return;
    if (!Array.isArray(value) || value.some((block) => !object(block))) {
      throw new ChatProtocolError("provider returned invalid reasoning details");
    }
    for (const block of value) this.chars += reasoningPayloadLength(block);
    if (this.chars > MAX_REASONING_CHARS || this.blocks.length + value.length > MAX_REASONING_BLOCKS) {
      throw new ChatProtocolError("provider reasoning details exceeded the size limit");
    }
    this.blocks.push(...value);
  }
}

/** One accumulator per completion: indexes identify deltas; IDs correlate results. */
export class ChatToolCalls {
  private calls = new Map<number, ChatToolCall>();
  private argumentChars = 0;

  add(value: unknown, streaming: boolean): void {
    if (value === undefined || value === null) return;
    if (!Array.isArray(value)) throw new ChatProtocolError("provider returned invalid tool_calls");
    const omitted = (field: unknown) => field === undefined || (streaming && field === null);
    for (const [position, raw] of value.entries()) {
      const delta = object(raw);
      const index = !streaming ? position : delta?.index ?? this.slotOf(delta?.id);
      if (!delta || !Number.isInteger(index) || Number(index) < 0 || Number(index) >= MAX_REPLY_TOOL_CALLS) {
        throw new ChatProtocolError("provider returned an invalid tool-call index");
      }
      const call = this.calls.get(Number(index)) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
      if (!omitted(delta.type) && delta.type !== "function") throw new ChatProtocolError("unsupported tool-call type");
      if (!omitted(delta.id)) {
        if (typeof delta.id !== "string" || !delta.id || delta.id.length > 256 || (call.id && call.id !== delta.id)) {
          throw new ChatProtocolError("provider changed or omitted a tool-call ID");
        }
        call.id = delta.id;
      }
      if (delta.function !== undefined) {
        const fn = object(delta.function);
        if (!fn) throw new ChatProtocolError("provider returned an invalid tool-call function");
        for (const field of ["name", "arguments"] as const) {
          if (omitted(fn[field])) continue;
          if (typeof fn[field] !== "string") throw new ChatProtocolError("provider returned invalid tool-call arguments or name");
          call.function[field] += fn[field];
          if (field === "arguments") this.argumentChars += fn[field].length;
        }
      }
      if (call.function.name.length > 64 || this.argumentChars > MAX_ARGUMENT_CHARS) {
        throw new ChatProtocolError("provider tool calls exceeded the size limit");
      }
      this.calls.set(Number(index), call);
    }
  }

  /** Gemini's OpenAI-compatible endpoint streams each call whole, with an id and no index: the slot of the call with
   * that id, else the one after the last. */
  private slotOf(id: unknown): number | undefined {
    if (typeof id !== "string" || !id) return undefined;
    for (const [slot, call] of this.calls) if (call.id === id) return slot;
    return this.calls.size ? Math.max(...this.calls.keys()) + 1 : 0;
  }

  finish(reason: string | null, malformedFrame: boolean): ChatToolCall[] {
    const calls = [...this.calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
    if (malformedFrame) throw new ChatProtocolError("provider stream contained a malformed completion frame");
    if (reason === "function_call") throw new ChatProtocolError("legacy function_call is unsupported; use structured tool_calls");
    if (reason === "tool_calls" && !calls.length) throw new ChatProtocolError("provider ended for tool calls without a complete call");
    if (!calls.length) return calls;
    if (reason !== null && reason !== "tool_calls" && reason !== "stop") {
      throw new ChatProtocolError("provider tool calls were truncated or malformed");
    }
    const ids = new Set<string>();
    for (const call of calls) {
      if (!call.id || ids.has(call.id) || !/^[A-Za-z0-9_-]{1,64}$/.test(call.function.name)) {
        throw new ChatProtocolError("provider returned an incomplete or duplicate tool call");
      }
      ids.add(call.id);
    }
    return calls;
  }
}
