import type { DesktopPrefs } from "./desktop-prefs.mjs";

export declare const QUICK_ASKS_TITLE: "Quick asks";
/** `starting`: this computer's server is not up yet; `moved`: its bots moved to My Cloud, so it takes no asks. My Cloud's
 * (talk-cloud.mjs): `cloud-down` it did not answer (or no verified My Cloud), `cloud-waking` it is asleep or waking,
 * `wake-failed` waking it failed or took too long, `cloud-signin` the window's sign-in there ended and could not be
 * renewed. */
export type TalkServerErrorCode = "server-down" | "starting" | "no-mausbot" | "refused" | "moved" | "lost" | "cloud-down" | "cloud-waking" | "wake-failed" | "cloud-signin";
export declare class TalkServerError extends Error {
  constructor(code: TalkServerErrorCode);
  readonly code: TalkServerErrorCode;
}
/** MausBot's Quick asks chat on the server asked (this computer's, or My Cloud while it is home). */
export interface TalkChat { botId: string; threadId: string }
/** `text` is the reply as last shown: the streamed words, then the finished message. */
export type TalkUpdate =
  | { kind: "thinking" }
  | { kind: "reply"; text: string }
  | { kind: "needs-you" }
  | { kind: "done"; ok: boolean; text: string };
export interface TalkBot { id: string; defaultBot?: { person?: string }; chiefOfStaff?: boolean; hidden?: boolean }
/** This computer's own MausBot (not a Team Cloud member's), else the Chief of Staff. */
export declare function findMausBot<T extends TalkBot>(bots: readonly T[]): T | null;
/** Server-sent events whose data is JSON; `signal` cancels the stream. */
export declare function readFrames(body: ReadableStream<Uint8Array>, onFrame: (frame: object) => void, signal?: AbortSignal): Promise<void>;
/** Follows the frames of one ask: from its own echoed message, through the turn that answers it. That turn is the
 * running one when the ask was steered into it, else the first turn not already under way before the echo; frames of
 * any other turn are ignored, so a box never shows another ask's reply. */
export declare function createReplyTracker(options: { threadId: string; sendId: string }): (frame: object) => TalkUpdate | null;
export declare function createTalkServer(options: {
  /** A request to the one server asked: this computer's own, or My Cloud while it is home; never a team's. A
   * TalkServerError it throws is the reason given. */
  request: (route: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;
  prefs: Pick<DesktopPrefs, "quickAsksChat" | "setQuickAsksChat">;
  /** Which server the saved Quick asks chat belongs to. */
  serverKey: () => string;
  /** This computer's server is on its way up, so a request that can't reach it says "starting". */
  starting?: () => boolean;
  /** The reason a server that did not answer gives, instead of "starting" or "server-down". */
  unreachable?: () => TalkServerError;
}): {
  /** Rejects with TalkServerError "server-down", "starting", "no-mausbot", "refused" or "moved". One call runs at a
   * time; a call while one runs gets the same promise. A server that refuses `select` (400) makes the chat without it. */
  prepare(): Promise<TalkChat>;
  /** Rejects with TalkServerError "server-down", "starting", "refused", "moved" or "lost", or with `signal.reason`. */
  ask(input: { chat: TalkChat; text: string; sendId: string; signal: AbortSignal; onUpdate: (update: TalkUpdate) => void }): Promise<"done" | "needs-you" | "failed">;
};
