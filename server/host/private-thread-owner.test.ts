import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Notification } from "../../shared/notification.ts";
import * as atomic from "../atomic.ts";
import { audienceIncludes, memberAudience } from "../audience.ts";
import { DATA_DIR } from "../config.ts";
import { personKey } from "../person-key.ts";
import { Store, type BotRecord } from "../store.ts";
import { ThreadStarters } from "../thread-starters.ts";
import { createCloudTeamHost } from "./cloud-team-host.ts";
import { createTeamMessages } from "./team-messages.ts";

const ADA = { email: "ada@acme.test", role: "admin" as const };
const BOB = { email: "bob@acme.test", role: "member" as const };
const CARL = { email: "carl@acme.test", role: "owner" as const };
const key = (email: string) => personKey({ id: "", email });
const stopped: Array<() => void> = [];
beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));
afterEach(() => { for (const stop of stopped.splice(0)) stop(); vi.restoreAllMocks(); });

function fixture() {
  const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
  const bot = store.createBot({ name: "Scout", createdBy: BOB.email });
  store.setChiefOfStaff(bot.id);
  const origin = store.createTask(bot.id, "Ada's plans", false)!.threadId;
  const ownersDir = join(DATA_DIR, "owners");
  mkdirSync(ownersDir);
  const file = join(ownersDir, "thread-starters.json");
  new ThreadStarters(file).set(origin, key(ADA.email));
  const open = (engineHomes?: Parameters<typeof createCloudTeamHost>[0]["engineHomes"]) => {
    const starters = new ThreadStarters(file);
    const current = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
    const host = createCloudTeamHost({ team: { id: "acme", name: "Acme" }, dataDir: DATA_DIR, store: current, starters, markers: new Set(), engineHomes });
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

function legacyFixture(records: "homes" | "items" | "both" = "both") {
  const f = fixture();
  f.team.stop();
  f.store.createBot({ name: "Mira" });
  f.store.createBot({ name: "Cleo" });
  const botsFile = join(DATA_DIR, "bots.json");
  const bots = JSON.parse(readFileSync(botsFile, "utf8")) as BotRecord[];
  const destinations = bots.flatMap((bot, index) => Array.from({ length: 20 }, (_, number) => {
    const threadId = `legacy-${index}-${number}`;
    bot.tasks!.push({ ...bot.tasks![0]!, threadId, title: "Legacy inbox" });
    return { botId: bot.id, threadId, person: key(`${threadId}@acme.test`) };
  }));
  const homes = records === "items" ? {} : Object.fromEntries(destinations.map(({ person, botId, threadId }) => [person, { botId, threadId }]));
  const items = records === "homes" ? [] : destinations.map((at) => ({ ...at, id: at.threadId, kind: "message", from: "Ada", text: "Private date", at: 1 }));
  writeFileSync(botsFile, JSON.stringify(bots));
  writeFileSync(join(DATA_DIR, "person-inbox.json"), JSON.stringify({ version: 1, homes, items }));
  new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
  return { ...f, botsFile, destinations };
}

describe("private message ownership", () => {
  it.each(["homes", "items", "both"] as const)("backfills many legacy destinations from %s with one registry save and needs no save after restart", (records) => {
    const f = legacyFixture(records);
    const save = vi.spyOn(atomic, "writeFileAtomicIfChanged");
    const restarted = f.open();
    expect(save.mock.calls.filter(([file]) => file === f.botsFile)).toHaveLength(1);
    for (const at of f.destinations) {
      expect(restarted.store.taskByThread(at.botId, at.threadId)?.private).toBe(true);
      expect(restarted.starters.get(at.threadId)).toBeUndefined();
    }
    expect(restarted.host.audienceOf(f.main)).toBe("team");
    restarted.team.stop();
    f.open().team.stop();
    expect(save.mock.calls.filter(([file]) => file === f.botsFile)).toHaveLength(1);
    rmSync(join(DATA_DIR, "person-inbox.json"));
    const again = f.open();
    for (const at of f.destinations) expect(again.host.audienceOf(at.threadId)).toBe(`member:unowned-${at.threadId}`);
    expect(save.mock.calls.filter(([file]) => file === f.botsFile)).toHaveLength(1);
  });

  it("keeps every legacy destination denied in memory and logs a failed registry save", () => {
    const f = legacyFixture();
    const write = atomic.writeFileAtomicIfChanged;
    const save = vi.spyOn(atomic, "writeFileAtomicIfChanged").mockImplementation((file, ...args) => {
      if (file === f.botsFile) throw new Error("synthetic registry save failure");
      return write(file, ...args);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const restarted = f.open();
    expect(save.mock.calls.filter(([file]) => file === f.botsFile)).toHaveLength(1);
    for (const at of f.destinations) {
      expect(restarted.store.taskByThread(at.botId, at.threadId)?.private).toBe(true);
      for (const person of [ADA, BOB, CARL]) expect(restarted.sees(person.email, at.threadId)).toBe(false);
    }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("could not save"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("synthetic registry save failure"));
  });

  it.each(["homes", "items"])("isolates an untouched ownerless legacy inbox from %s before engine-home migration", (records) => {
    const f = fixture();
    const shared = f.store.createTask(f.botId, "Shared work", false)!.threadId;
    expect(f.team.pass(f.botId, f.origin, "Bob", "Private launch date").status).toBe(200);
    const target = f.store.tasks(f.botId).find((task) => task.title === "Inbox")!.threadId;
    f.team.stop();
    const botsFile = join(DATA_DIR, "bots.json");
    const bots = JSON.parse(readFileSync(botsFile, "utf8")) as Array<{ tasks: Array<{ threadId: string; private?: true }> }>;
    for (const bot of bots) for (const task of bot.tasks) if (task.threadId === target) delete task.private;
    writeFileSync(botsFile, JSON.stringify(bots));
    const owners = JSON.parse(readFileSync(f.file, "utf8"));
    delete owners[target];
    writeFileSync(f.file, JSON.stringify(owners));
    const inboxFile = join(DATA_DIR, "person-inbox.json");
    const inbox = JSON.parse(readFileSync(inboxFile, "utf8"));
    if (records === "homes") inbox.items = [];
    else inbox.homes = {};
    writeFileSync(inboxFile, JSON.stringify(inbox));
    let migratedAudience: string | undefined;
    const restarted = f.open({ start: ({ audienceOf }) => { migratedAudience = audienceOf(target); } });
    expect(migratedAudience).toBe(`member:unowned-${target}`);
    expect(restarted.starters.get(target)).toBeUndefined();
    expect(restarted.store.taskByThread(f.botId, target)?.private).toBe(true);
    expect(restarted.host.audienceOf(f.main)).toBe("team");
    expect(restarted.host.audienceOf(shared)).toBe("team");
    expect(restarted.host.audienceOf(f.origin)).toBe(memberAudience(key(ADA.email)));
    for (const person of [ADA, BOB, CARL]) expect(restarted.sees(person.email, target), person.email).toBe(false);
    expect(restarted.store.messagesFor(target).map((message) => message.text)).toEqual(["Private launch date"]);
    restarted.team.stop();
    rmSync(inboxFile);
    expect(f.open().host.audienceOf(target)).toBe(`member:unowned-${target}`);
  });

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
