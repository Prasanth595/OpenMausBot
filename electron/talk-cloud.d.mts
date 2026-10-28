import type { CloudPower } from "./cloud-power.mjs";
import type { DesktopPrefs } from "./desktop-prefs.mjs";
import type { TalkChat, TalkUpdate } from "./talk-server.mjs";

export declare const TALK_CLOUD_TIMING: Readonly<{ requestMs: number; wakeMs: number }>;
export declare function createCloudTalkServer(options: {
  /** My Cloud's verified origin while it is home, else null (then nothing is asked). */
  origin: () => string | null;
  /** The app window's own session's fetch, which holds its sign-in at My Cloud. */
  fetch: typeof fetch;
  /** Signs the window in to My Cloud again with the Admin's code for it; false when that failed. */
  reconnect: (origin: string) => Promise<boolean>;
  power: { asleep(): boolean; hold(): void; woke(): void };
  account: () => { power(): CloudPower | null; wakeHome(): Promise<unknown>; setWaking(on: boolean): void } | null;
  prefs: Pick<DesktopPrefs, "quickAsksChat" | "setQuickAsksChat">;
  timing?: { requestMs: number; wakeMs: number };
}): {
  /** As createTalkServer's, after waking a sleeping My Cloud; `onWaking` is told when it does. Also rejects with
   * TalkServerError "cloud-down", "cloud-waking", "wake-failed" or "cloud-signin". */
  prepare(onWaking?: () => void): Promise<TalkChat>;
  ask(input: { chat: TalkChat; text: string; sendId: string; signal: AbortSignal; onUpdate: (update: TalkUpdate) => void }): Promise<"done" | "needs-you" | "failed">;
};
