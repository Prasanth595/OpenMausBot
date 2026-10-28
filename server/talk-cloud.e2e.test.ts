// A real server standing in for My Cloud, asked the way the talk shortcut asks My Cloud: over a browser sign-in's
// cookie that the app window holds (redeemed from a one-time code with `cookie: true`), never a token, with the
// server's own same-origin rules for such a session.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createCloudPowerGate } from "../electron/cloud-power.mjs";
import { createCloudTalkServer } from "../electron/talk-cloud.mjs";
import type { TalkChat, TalkUpdate } from "../electron/talk-server.mjs";
import { launchVerificationServer } from "../scripts/control-omb.ts";

let fixture: Awaited<ReturnType<typeof launchVerificationServer>>;
let jar = "";
const reconnects: string[] = [];

/** A one-time code from the server, redeemed into the "window's" cookie. */
async function signIn(): Promise<boolean> {
  const url = fixture.info.url;
  const opened = await fetch(`${url}/api/auth/pairing`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const { code } = await opened.json() as { code: string };
  const paired = await fetch(`${url}/api/auth/pair`, { method: "POST", headers: { "content-type": "application/json", origin: url }, body: JSON.stringify({ code, label: "OpenMausBot app", cookie: true }) });
  jar = (paired.headers.get("set-cookie") ?? "").split(";", 1)[0]!;
  return paired.ok && jar.includes("=");
}

/** Electron's session fetch for the window: its cookie goes with every request to that origin. */
const windowFetch: typeof fetch = (input, init = {}) => fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), cookie: jar } });

function talk(renew = true) {
  let saved: TalkChat | null = null;
  return createCloudTalkServer({
    origin: () => fixture.info.url,
    fetch: windowFetch,
    reconnect: async (origin) => { reconnects.push(origin); return renew && origin === fixture.info.url && await signIn(); },
    power: createCloudPowerGate(),
    account: () => null,
    prefs: { quickAsksChat: () => saved, setQuickAsksChat: (_server, chat) => { saved = chat; } },
  });
}

async function logOut() {
  const out = await windowFetch(`${fixture.info.url}/api/auth/logout`, { method: "POST", headers: { "content-type": "application/json", origin: fixture.info.url }, body: "{}" });
  expect(out.ok).toBe(true);
  const stale = await windowFetch(`${fixture.info.url}/api/bots?messages=0`);
  expect(stale.status).toBe(401);
}

beforeAll(async () => {
  fixture = await launchVerificationServer();
  expect(await signIn()).toBe(true);
}, 90_000);
afterAll(async () => {
  await fixture?.close();
});

it("asks MausBot over the window's cookie session there, makes Quick asks without opening it, and follows the reply", async () => {
  const session = await (await windowFetch(`${fixture.info.url}/api/auth/session`)).json() as { kind?: string };
  expect(session.kind).toBe("session");
  const elsewhere = await windowFetch(`${fixture.info.url}/api/bots?messages=0`, { headers: { origin: "https://elsewhere.example.test" } });
  expect(elsewhere.status, "the cookie counts only for its own origin").toBe(403);
  const before = (await (await windowFetch(`${fixture.info.url}/api/bots?messages=0`)).json() as any).bots.find((b: any) => b.defaultBot);
  const cloud = talk();
  const chat = await cloud.prepare();
  expect(chat.botId).toBe(before.id);
  const updates: TalkUpdate[] = [];
  expect(await cloud.ask({ chat, text: "What can you do?", sendId: randomUUID(), signal: AbortSignal.timeout(60_000), onUpdate: (u) => updates.push(u) })).toBe("done");
  expect(updates.at(-1)).toMatchObject({ kind: "done", ok: true, text: expect.stringContaining("hello from fake claude") });
  const after = (await (await windowFetch(`${fixture.info.url}/api/bots?messages=0`)).json() as any).bots.find((b: any) => b.id === chat.botId);
  expect(after.threadId).toBe(before.threadId);
  expect(reconnects).toEqual([]);
}, 90_000);

it("a session that ended is renewed once and the ask goes through; one that can't be renewed says sign in", async () => {
  const cloud = talk();
  const chat = await cloud.prepare();
  await logOut();
  expect(await cloud.ask({ chat, text: "Still there?", sendId: randomUUID(), signal: AbortSignal.timeout(60_000), onUpdate: () => {} })).toBe("done");
  expect(reconnects).toEqual([fixture.info.url]);

  await logOut();
  await expect(talk(false).prepare()).rejects.toMatchObject({ name: "TalkServerError", code: "cloud-signin" });
  expect(await signIn()).toBe(true);
}, 90_000);
