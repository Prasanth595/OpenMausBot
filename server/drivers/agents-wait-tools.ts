import { WAIT_HOURS, WAIT_KINDS } from "../../shared/waits.ts";
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

const WAITS = "/api/internal/waits";
export const WAIT_TOOL_NAMES: ReadonlySet<string> = new Set(["wait_until", "list_waits", "cancel_wait"]);

export async function callWaitTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } =
    name === "list_waits"
      ? await context.client.apiResponse(WAITS)
      : await context.client.apiResponse(name === "cancel_wait" ? `${WAITS}/cancel` : WAITS, { method: "POST", body: JSON.stringify(args) });
  return ok ? { text: String(body.text ?? "") } : { text: String(body.error ?? "The wait did not go through. Try again shortly."), isError: true };
}

export const WAIT_TOOL_DEFINITIONS = [
  {
    name: "wait_until",
    description:
      `Tell the person when something happens, with no AI running while you wait: plain code checks a web page for some words (every minute), a file or folder (there, gone or changed), a program (running or stopped), or another bot finishing its work. When it happens a message lands in this chat with a notification; with follow_up, you also carry out follow_up here. Use it instead of staying busy or a short-interval routine. If it is already true nothing is set up and the result says so: tell the person at once. Files and programs are those of the computer OpenMausBot runs on, only when you work on it. A wait stops after hours (default ${WAIT_HOURS.default}, at most ${WAIT_HOURS.max}).`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string", maxLength: 120, description: 'The person\'s words for it, e.g. "the build finishes".' },
        kind: {
          type: "string",
          enum: [...WAIT_KINDS],
          description: "url_* = a page says or no longer says text; file_* = path exists, is gone or changes; process_* = a program runs or stops; bot_idle = another bot finishes its work.",
        },
        url: { type: "string", description: "url_*: the http(s) page." },
        text: { type: "string", description: "url_*: the words to look for, any case." },
        path: { type: "string", description: "file_*: a full path; ~ is the home folder." },
        process: { type: "string", description: "process_*: the program's name, any case, or its process id." },
        bot: { type: "string", description: "bot_idle: the other bot's name or id from list_bots." },
        follow_up: {
          type: "string",
          maxLength: 2000,
          description: "Only when the person asked for something to happen then: that request, written for a run that will not see this conversation.",
        },
        hours: { type: "integer", minimum: 1, maximum: WAIT_HOURS.max },
      },
      required: ["label", "kind"],
    },
  },
  {
    name: "list_waits",
    description: "Your waits that have not ended (wait_until): id, label, what it checks, when it was made and when it stops.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "cancel_wait",
    description: "Stop one of your waits; its id comes from list_waits or wait_until's answer.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", minLength: 1 } },
      required: ["id"],
    },
  },
];
