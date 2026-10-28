// The talk shortcut's asks once home is My Cloud: MausBot there, over the sign-in the app window already holds at My
// Cloud (its cookie in the window's own session). A session that ended signs the window in again, once, through the
// Admin's code for My Cloud alone. A sleeping My Cloud is woken at the press the way the window opens it.
// Security: never a credential of its own, never another Cloud's origin.
import { asleepAnswer, openSleepingCloud } from "./cloud-power.mjs";
import { createTalkServer, TalkServerError } from "./talk-server.mjs";

export const TALK_CLOUD_TIMING = Object.freeze({ requestMs: 30_000, wakeMs: 45_000 });

const drop = response => void response.body?.cancel().catch(() => {});
const tell = watcher => { try { watcher(); } catch {} };

/**
 * @param {{
 *   origin(): string | null,
 *   fetch: typeof fetch,
 *   reconnect(origin: string): Promise<boolean>,
 *   power: { asleep(): boolean, hold(): void, woke(): void },
 *   account(): { power(): any, wakeHome(): Promise<unknown>, setWaking(on: boolean): void } | null,
 *   prefs: { quickAsksChat(server: string): unknown, setQuickAsksChat(server: string, chat: unknown): void },
 *   timing?: { requestMs: number, wakeMs: number },
 * }} deps `origin()`: My Cloud's verified origin while it is home, else null. `fetch`: the window's own session's.
 * `reconnect`: signs the window in to My Cloud again (signInCloudSession). `power`: the gate Files and lending share.
 * `account()`: the MausBot Cloud sign-in, whose Admin wakes My Cloud.
 */
export function createCloudTalkServer({ origin, fetch: fetchImpl, reconnect, power, account, prefs, timing = TALK_CLOUD_TIMING }) {
  const where = () => {
    const at = origin();
    if (!at) throw new TalkServerError("cloud-down");
    return at;
  };
  // No x-omb-background: a quick ask is the person using My Cloud, so it also keeps My Cloud awake while MausBot answers.
  const call = (at, route, init) => fetchImpl(`${at}${route}`, {
    ...init, credentials: "include", redirect: "error", cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(timing.requestMs), headers: { ...init.headers, origin: at },
  });
  async function request(route, init = {}) {
    const at = where();
    let response = await call(at, route, init);
    if (response.status === 401) {
      drop(response);
      if (!(await reconnect(at).catch(() => false))) throw new TalkServerError("cloud-signin");
      response = await call(at, route, init);
      if (response.status === 401) { drop(response); throw new TalkServerError("cloud-signin"); }
    }
    if (asleepAnswer(response)) {
      drop(response);
      power.hold();
      throw new TalkServerError("cloud-waking");
    }
    return response;
  }
  /** My Cloud answered at all; its sign-in is the next request's business. */
  async function answers(at, ms) {
    try {
      const response = await fetchImpl(`${at}/api/auth/session`, { credentials: "include", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(ms), headers: { origin: at } });
      drop(response);
      return !asleepAnswer(response) && response.status < 500;
    } catch {
      return false;
    }
  }

  const server = createTalkServer({ request, prefs, serverKey: () => where(), unreachable: () => new TalkServerError(power.asleep() ? "cloud-waking" : "cloud-down") });
  let preparing = null, waking = false;
  const watchers = new Set();

  async function wake() {
    if (!power.asleep()) return;
    const at = where(), client = account();
    waking = true;
    for (const watcher of watchers) tell(watcher);
    let timer;
    const late = new Promise(resolve => { timer = setTimeout(() => resolve(false), timing.wakeMs); timer.unref?.(); });
    try {
      const woke = openSleepingCloud({ power: client?.power() ?? { state: "asleep" }, wake: () => client?.wakeHome(), waking: on => client?.setWaking(on), signedIn: ms => answers(at, ms) });
      if (!(await Promise.race([woke, late]))) throw new TalkServerError("wake-failed");
    } finally {
      clearTimeout(timer);
      waking = false;
    }
    power.woke();
  }

  return {
    /** `onWaking`: told when this preparation wakes My Cloud (at once if one is waking it now). */
    prepare(onWaking) {
      if (typeof onWaking === "function") {
        watchers.add(onWaking);
        if (waking) tell(onWaking);
      }
      preparing ??= (async () => {
        await wake();
        try {
          return await server.prepare();
        } catch (error) {
          // My Cloud said it is going to sleep (the gate now holds): woken, it is asked once more. Nothing was made.
          if (error?.code !== "cloud-waking" || !power.asleep()) throw error;
        }
        await wake();
        return server.prepare();
      })().finally(() => {
        preparing = null;
        watchers.clear();
      });
      return preparing;
    },
    ask: input => server.ask(input),
  };
}
