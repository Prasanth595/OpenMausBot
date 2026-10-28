import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Notification } from "../../shared/notification.ts";
import { audienceIncludes, memberAudience } from "../audience.ts";
import { DATA_DIR } from "../config.ts";
import { personKey } from "../person-key.ts";
import { Store } from "../store.ts";
import { ThreadStarters } from "../thread-starters.ts";
import { createCloudTeamHost } from "./cloud-team-host.ts";
import { createTeamMessages } from "./team-messages.ts";

const ADA = { email: "ada@acme.test", role: "admin" as const };
const BOB = { email: "bob@acme.test", role: "member" as const };
const CARL = { email: "carl@acme.test", role: "owner" as const };
const key = (email: string) => personKey({ id: "", email });
const stopped: Array<() => void> = [];
beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));
afterEach(() => { for (const stop of stopped.splice(0)) stop(); });

function fixture() {
  const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
  const bot = store.createBot({ name: "Scout", createdBy: BOB.email });
  store.setChiefOfStaff(bot.id);
  const origin = store.createTask(bot.id, "Ada's plans", false)!.threadId;
  const ownersDir = join(DATA_DIR, "owners");
  mkdirSync(ownersDir);
  const file = join(ownersDir, "thread-starters.json");
  new ThreadStarters(file).set(origin, key(ADA.email));
  const open = () => {
    const starters = new ThreadStarters(file);
    const current = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
    const host = createCloudTeamHost({ team: { id: "acme", name: "Acme" }, dataDir: DATA_DIR, store: current, starters, markers: new Set() });
    const notified: Notification[] = [];
    const sees = (email: string, threadId: string) => audienceIncludes(host.audienceOf(threadId), { person: key(email), admin: true, seesRoom: () => true });
    const team = createTeamMessages({
      team: { id: "acme", name: "Acme" }, dataDir: DATA_DIR, store: current, starters,
      audienceOf: host.audienceOf, personName: () => undefined,
      people: { everyone: () => [ADA, BOB, CARL].map((person) => ({ ...person, firstSeenAt: 1, lastSeenAt: 1 })) },
      sees: (person) => ({ bot: () => true, thread: (threadId) => sees(person.email, threadId) }),
      notify: (notification) => { notified.push(notification); },
      inbox: { askedPerson: () => null, continueTurn: () => {} },
    });
    stopped.push(team.stop);
    return { store: current, starters, host, team, notified, sees };
  };
  return { ...open(), botId: bot.id, main: bot.threadId, origin, file, ownersDir, open };
}

describe("private message ownership", () => {
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("rolls back the provisional thread on EACCES, publishes nothing, and can retry", () => {
    const f = fixture();
    const before = f.store.tasks(f.botId).map((task) => task.threadId);
    chmodSync(f.ownersDir, 0o500);
    try {
      expect(() => f.team.pass(f.botId, f.origin, "Bob", "Private launch date")).toThrow(expect.objectContaining({ code: "EACCES" }));
      expect(f.store.tasks(f.botId).map((task) => task.threadId)).toEqual(before);
      expect(f.store.messagesFor(f.origin)).toEqual([]);
      expect(f.notified).toEqual([]);
    } finally {
      chmodSync(f.ownersDir, 0o700);
    }
    expect(f.open().store.tasks(f.botId).map((task) => task.threadId)).toEqual(before);
    expect(f.team.pass(f.botId, f.origin, "Bob", "Private launch date").status).toBe(200);
    const target = f.store.tasks(f.botId).find((task) => task.title === "Inbox")!.threadId;
    const restarted = f.open();
    expect(restarted.starters.get(target)).toBe(key(BOB.email));
    expect(restarted.store.messagesFor(target).map((message) => message.text)).toEqual(["Private launch date"]);
    expect(restarted.sees(BOB.email, target)).toBe(true);
    expect(restarted.sees(CARL.email, target)).toBe(false);
  });

  it.each([false, true])("keeps a private thread hidden after its owner is lost on disk (legacy: %s)", (legacy) => {
    const f = fixture();
    expect(f.team.pass(f.botId, f.origin, "Bob", "Private launch date").status).toBe(200);
    const target = f.store.tasks(f.botId).find((task) => task.title === "Inbox")!.threadId;
    if (legacy) {
      const botsFile = join(DATA_DIR, "bots.json");
      const bots = JSON.parse(readFileSync(botsFile, "utf8")) as Array<{ tasks: Array<{ threadId: string; private?: true }> }>;
      for (const bot of bots) for (const task of bot.tasks) if (task.threadId === target) delete task.private;
      writeFileSync(botsFile, JSON.stringify(bots));
      expect(f.open().team.pass(f.botId, f.origin, "Bob", "Private legacy follow-up").status).toBe(200);
    }
    const owners = JSON.parse(readFileSync(f.file, "utf8"));
    delete owners[target];
    writeFileSync(f.file, JSON.stringify(owners));
    const restarted = f.open();
    expect(restarted.host.audienceOf(f.main)).toBe("team");
    expect(restarted.host.audienceOf(f.origin)).toBe(memberAudience(key(ADA.email)));
    for (const person of [ADA, BOB, CARL]) expect(restarted.sees(person.email, target), person.email).toBe(false);
    expect(restarted.store.messagesFor(target).map((message) => message.text)).toEqual([
      "Private launch date", ...(legacy ? ["Private legacy follow-up"] : []),
    ]);
    expect(restarted.team.pass(f.botId, f.origin, "Bob", "Another private date").status).toBe(200);
    expect(restarted.store.messagesFor(target)).toHaveLength(legacy ? 2 : 1);
    expect(restarted.store.tasks(f.botId).filter((task) => task.title === "Inbox")).toHaveLength(2);
  });
});
