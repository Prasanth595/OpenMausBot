import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTalkServer, QUICK_ASKS_TITLE, type TalkChat, type TalkUpdate } from "../electron/talk-server.mjs";
import { launchVerificationServer } from "../scripts/control-omb.ts";

const owner = randomBytes(32).toString("base64url");
const realFetch = globalThis.fetch;
let fixture: Awaited<ReturnType<typeof launchVerificationServer>>;
const request = (route: string, init?: RequestInit) => fetch(`${fixture.info.url}${route}`, init);

beforeAll(async () => {
  globalThis.fetch = (input, init = {}) => realFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": owner } });
  fixture = await launchVerificationServer({ ...process.env, OMB_TEST_DESKTOP_OWNER_TOKEN: owner });
}, 90_000);
afterAll(async () => {
  globalThis.fetch = realFetch;
  await fixture?.close();
});

it("asks MausBot in its own Quick asks chat, as the desktop app does, and follows the reply to the end", async () => {
  let saved: TalkChat | null = null;
  const talk = createTalkServer({ request, serverKey: () => "fixture", prefs: { quickAsksChat: () => saved, setQuickAsksChat: (_s, chat) => { saved = chat; } } });
  const before = (await (await request("/api/bots?messages=0")).json() as any).bots.find((b: any) => b.defaultBot);
  const chat = await talk.prepare();
  expect(chat.botId).toBe(before.id);
  const updates: TalkUpdate[] = [];
  expect(await talk.ask({ chat, text: "What can you do?", sendId: randomUUID(), signal: AbortSignal.timeout(60_000), onUpdate: u => updates.push(u) })).toBe("done");
  expect(updates[0]).toEqual({ kind: "thinking" });
  expect(updates.at(-1)).toMatchObject({ kind: "done", ok: true, text: expect.stringContaining("hello from fake claude") });
  const after = (await (await request("/api/bots?messages=0")).json() as any).bots.find((b: any) => b.id === chat.botId);
  expect(after.threadId).toBe(before.threadId);
  expect(after.tasks.find((t: any) => t.threadId === chat.threadId).title).toBe(QUICK_ASKS_TITLE);
  expect(await talk.prepare()).toEqual(chat);
}, 90_000);
