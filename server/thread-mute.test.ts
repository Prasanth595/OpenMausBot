import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { callTool, type ToolCallContext } from "./drivers/agents-call.ts";
import { availableTools, catalogProfileFromEnv } from "./drivers/agents-catalog.ts";
import { mutedThreadNotifies, THREAD_MUTE_POLICY, threadNotificationsMuted, type ThreadMuteDefault, type ThreadMuteNotice } from "./notify.ts";
import { createInternalThreadRoutes } from "./routes/internal-threads.ts";
import { Store } from "./store.ts";

const opener = { botId: "chief", name: "Chief", at: 1 };
const off: ThreadMuteDefault = { botOpened: false, mainThreadId: "main" };
const on: ThreadMuteDefault = { botOpened: true, mainThreadId: "main" };

describe("which notifications a muted thread still sends", () => {
  // [bot has a Chief of Staff, bot has none]: true means the person is still notified.
  const expected: Record<ThreadMuteNotice, [boolean, boolean]> = {
    done: [false, false],
    "delegation-settled": [false, false],
    mention: [false, false],
    "routine-deferred": [false, false],
    approval: [false, false],
    question: [false, false],
    "sign-in": [false, false],
    "turn-failed": [false, true],
    "routine-failed": [false, true],
    incident: [true, true],
    "peer-approval": [true, true],
    spend: [true, true],
  };

  it("covers every notification kind", () => {
    expect(Object.keys(THREAD_MUTE_POLICY).sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(Object.entries(expected) as Array<[ThreadMuteNotice, [boolean, boolean]]>)("%s, muted, with and without a Chief of Staff", (notice, [withChief, withoutChief]) => {
    expect(mutedThreadNotifies(notice, () => true)).toBe(withChief);
    expect(mutedThreadNotifies(notice, () => false)).toBe(withoutChief);
  });
});

describe("threadNotificationsMuted", () => {
  it("changes nothing for anyone who never muted a thread or opted in", () => {
    expect(threadNotificationsMuted({ threadId: "t" }, off)).toBe(false);
    expect(threadNotificationsMuted({ threadId: "t", openedBy: opener }, off)).toBe(false);
  });

  it("follows an explicit choice either way, whatever the default", () => {
    expect(threadNotificationsMuted({ threadId: "t", notificationsMuted: true }, off)).toBe(true);
    expect(threadNotificationsMuted({ threadId: "main", notificationsMuted: true }, on)).toBe(true);
    expect(threadNotificationsMuted({ threadId: "t", openedBy: opener, notificationsMuted: false }, on)).toBe(false);
  });

  it("with the opt-in, mutes threads a bot opened but never the person's own or the bot's main chat", () => {
    expect(threadNotificationsMuted({ threadId: "t", openedBy: opener }, on)).toBe(true);
    expect(threadNotificationsMuted({ threadId: "t" }, on)).toBe(false);
    expect(threadNotificationsMuted({ threadId: "main", openedBy: opener }, on)).toBe(false);
  });
});

describe("a thread's stored mute", () => {
  const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
  const storedTask = (botId: string, threadId: string) =>
    (JSON.parse(readFileSync(join(DATA_DIR, "bots.json"), "utf8")) as Array<{ id: string; tasks: Array<Record<string, unknown>> }>)
      .find((bot) => bot.id === botId)!.tasks.find((task) => task.threadId === threadId)!;

  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("is absent on threads saved before it existed, so they follow the default", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Quinn" });
    const work = store.createTask(bot.id, "QA: PR #1", false, undefined, opener)!;
    expect(storedTask(bot.id, work.threadId)).not.toHaveProperty("notificationsMuted");
    const reloaded = new Store(selection).taskByThread(bot.id, work.threadId)!;
    expect(threadNotificationsMuted(reloaded, off)).toBe(false);
    expect(threadNotificationsMuted(reloaded, { botOpened: true, mainThreadId: bot.threadId })).toBe(true);
  });

  it("survives a restart once set, and clearing it returns the thread to the default", () => {
    const store = new Store(selection);
    const bot = store.createBot({ name: "Quinn" });
    const work = store.createTask(bot.id, "QA: PR #2", false, undefined, opener)!;
    store.patchTask(bot.id, work.threadId, { notificationsMuted: false });
    expect(new Store(selection).taskByThread(bot.id, work.threadId)?.notificationsMuted).toBe(false);
    store.patchTask(bot.id, work.threadId, { notificationsMuted: true });
    expect(new Store(selection).taskByThread(bot.id, work.threadId)?.notificationsMuted).toBe(true);
    store.patchTask(bot.id, work.threadId, { notificationsMuted: undefined });
    expect(storedTask(bot.id, work.threadId)).not.toHaveProperty("notificationsMuted");
  });
});

describe("mute_thread's route", () => {
  const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
  /** A Chief that reaches Quinn, and a thread the Chief opened on Quinn. */
  const team = () => {
    const store = new Store(selection);
    const chief = store.createBot({ name: "Charlie" });
    const qa = store.createBot({ name: "Quinn" });
    store.patchBot(chief.id, { chiefOfStaff: true, peers: [qa.id] });
    const work = store.createTask(qa.id, "Hidden title", false, undefined, { botId: chief.id, name: "Charlie", at: 1 })!;
    const mute = async (muted: boolean, shown: (threadId: string) => boolean = () => true) => {
      const out: { status?: number; body?: unknown } = {};
      const route = createInternalThreadRoutes({
        store, from: store.bot(chief.id)!, fromThreadId: chief.threadId,
        coordinator: { awaitingAnswer: () => false, parkedDirect: () => false, activeDirect: () => false } as never,
        ownsThread: () => true, shown, threadBusy: () => false, queuedThreadPosition: () => null,
        muteDefault: (botId) => ({ botOpened: false, mainThreadId: store.bot(botId)?.threadId }),
        readBody: async () => ({ muted }), requireActive: () => undefined,
      });
      await route({ res: {}, path: `/api/internal/threads/${work.threadId}/mute`, method: "POST",
        json: (_res: unknown, status: number, body: unknown) => { out.status = status; out.body = body; } } as never);
      return out;
    };
    const stored = () => store.taskByThread(qa.id, work.threadId)!;
    return { store, qa, work, mute, stored };
  };

  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("answers a thread the Chief may not see as missing: no title, nothing written", async () => {
    const { work, mute, stored } = team();
    const hidden = await mute(true, (threadId) => threadId !== work.threadId);
    expect(hidden.status).toBe(404);
    expect(JSON.stringify(hidden.body)).not.toContain("Hidden title");
    expect(stored()).not.toHaveProperty("notificationsMuted");
    expect((await mute(true)).status).toBe(200);
  });

  it("never changes the person's choice, and records its own as the Chief's", async () => {
    const { qa, work, store, mute, stored } = team();
    store.patchTask(qa.id, work.threadId, { notificationsMuted: true, notificationsMutedBy: "person" });
    const refused = await mute(false);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: expect.stringContaining("only they can change it") });
    expect((await mute(true)).status, "agreeing with the person is no change").toBe(200);
    expect(stored()).toMatchObject({ notificationsMuted: true, notificationsMutedBy: "person" });

    store.patchTask(qa.id, work.threadId, { notificationsMuted: undefined, notificationsMutedBy: undefined });
    expect((await mute(true)).status).toBe(200);
    expect(stored()).toMatchObject({ notificationsMuted: true, notificationsMutedBy: "chief" });
    expect((await mute(false)).status).toBe(200);
    expect(stored()).toMatchObject({ notificationsMuted: false, notificationsMutedBy: "chief" });
  });
});

describe("the mute_thread tool", () => {
  const routed = (respond: (path: string, body: unknown) => Record<string, unknown>) => {
    const calls: Array<{ path: string; body: unknown }> = [];
    const context: ToolCallContext = {
      botId: "chief", threadId: "chief-thread", depth: 0, externalRuntime: false, sharedComputers: false,
      client: {
        api: async (path, init) => {
          const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
          calls.push({ path, body });
          return respond(path, body);
        },
        apiResponse: async () => ({ ok: true, status: 200, body: {} }),
      },
    };
    return { calls, context };
  };

  it("is offered to a Chief of Staff only", () => {
    const names = (chief: boolean) => availableTools(catalogProfileFromEnv({ OMB_BOT_ID: "b", ...(chief ? { OMB_CHIEF_OF_STAFF: "1" } : {}) })).map((tool) => tool.name);
    expect(names(true)).toContain("mute_thread");
    expect(names(false)).not.toContain("mute_thread");
  });

  it("sends the choice to the thread's mute route and hands a refusal back as an error", async () => {
    const { calls, context } = routed((_path, body) => body && typeof body === "object" && "muted" in body && body.muted === true
      ? { threadId: "t-1", title: "QA: PR #9", botName: "Quinn", muted: true }
      : { error: "that thread is not yours to mute" });
    const muted = await callTool("mute_thread", { thread_id: " t-1 ", muted: true }, context);
    expect(muted.isError).toBeFalsy();
    expect(muted.text).toContain("Muted #QA: PR #9 on @Quinn");
    const refused = await callTool("mute_thread", { thread_id: "t-1", muted: false }, context);
    expect(refused).toMatchObject({ isError: true, text: expect.stringContaining("that thread is not yours to mute") });
    expect(calls).toEqual([
      { path: "/api/internal/threads/t-1/mute", body: { fromBotId: "chief", fromThreadId: "chief-thread", muted: true } },
      { path: "/api/internal/threads/t-1/mute", body: { fromBotId: "chief", fromThreadId: "chief-thread", muted: false } },
    ]);
    expect((await callTool("mute_thread", { thread_id: "t-1", muted: "yes" }, context)).isError).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("is what list_threads reports for each thread", async () => {
    const { context } = routed(() => ({ threads: [
      { threadId: "t-1", botName: "Quinn", title: "QA: PR #9", state: "idle", unread: false, muted: true, own: false },
      { threadId: "t-2", botName: "Quinn", title: "QA: PR #10", state: "idle", unread: false, muted: false, own: false },
    ] }));
    const lines = (await callTool("list_threads", {}, context)).text.split("\n");
    expect(lines.find((line) => line.includes("t-1"))).toContain("idle, notifications muted)");
    expect(lines.find((line) => line.includes("t-2"))).not.toContain("muted");
  });
});
