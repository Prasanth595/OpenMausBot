import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_POWER_HEADER, createCloudPowerGate } from "./cloud-power.mjs";
import { TALK_CLOUD_TIMING, createCloudTalkServer } from "./talk-cloud.mjs";

const CLOUD = "https://home.example.test";
const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve)); };
const BOTS = { bots: [{ id: "m", defaultBot: {}, tasks: [] }] };
const asleepAnswer = () => new Response(null, { status: 503, headers: { [CLOUD_POWER_HEADER]: "asleep" } });

/** My Cloud behind the window's own session: `routes` answers "METHOD /path" with a Response, or a list taken in turn. */
function world({ asleep = false, routes = {}, signIn = true, wake = async () => "awake", origin = CLOUD, timing } = {}) {
  const w = { calls: [], reconnects: [], wakes: 0, waking: [], said: 0, saves: [], power: asleep ? "asleep" : "awake", origin };
  const encoder = new TextEncoder();
  w.gate = createCloudPowerGate({ power: () => ({ state: w.power, since: 1, sleeps: true }) });
  const answer = key => {
    const route = routes[key];
    if (Array.isArray(route)) return route.length > 1 ? route.shift() : route[0];
    return route;
  };
  w.fetch = async (url, init = {}) => {
    const at = new URL(url), key = `${init.method ?? "GET"} ${at.pathname}${at.search}`;
    w.calls.push({ url: String(url), key, init });
    const given = answer(key);
    if (typeof given === "function") return given(init);
    if (given) return given;
    if (key === "GET /api/auth/session") return Response.json({ kind: "session" });
    if (key === "GET /api/bots?messages=0") return Response.json(BOTS);
    if (key === "POST /api/bots/m/tasks") return Response.json({ task: { threadId: "t-new" } }, { status: 201 });
    if (key === "GET /api/events?screens=off") {
      let stream;
      const body = new ReadableStream({ start: controller => { stream = controller; }, cancel: () => { w.events.cancelled = true; } });
      w.events = { cancelled: false, push: frame => stream.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)) };
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }
    if (key === "POST /api/bots/m/messages") return Response.json({ ok: true }, { status: 202 });
    return new Response(null, { status: 404 });
  };
  const account = {
    power: () => ({ state: w.power, since: 1, sleeps: true }),
    wakeHome: async () => { w.wakes += 1; const woke = await wake(); if (woke === "awake") { w.power = "awake"; w.gate.changed(); } return woke; },
    setWaking: on => { w.waking.push(on); },
  };
  w.talk = createCloudTalkServer({
    origin: () => w.origin, fetch: w.fetch, power: w.gate, account: () => account,
    reconnect: async at => { w.reconnects.push(at); w.onReconnect?.(); return signIn; },
    prefs: { quickAsksChat: () => null, setQuickAsksChat: (key, chat) => w.saves.push([key, chat]) },
    ...(timing ? { timing } : {}),
  });
  w.keys = () => w.calls.map(call => call.key);
  w.waked = () => { w.said += 1; };
  return w;
}

test("My Cloud has 30 s for a request and 45 s to wake", () => {
  assert.deepEqual(TALK_CLOUD_TIMING, { requestMs: 30_000, wakeMs: 45_000 });
  assert.ok(Object.isFrozen(TALK_CLOUD_TIMING));
});

test("asks go to My Cloud over the window's own sign-in there, as the person, and its chat is kept under its origin", async () => {
  const w = world();
  assert.deepEqual(await w.talk.prepare(w.waked), { botId: "m", threadId: "t-new" });
  assert.deepEqual(w.keys(), ["GET /api/bots?messages=0", "POST /api/bots/m/tasks"]);
  for (const { url, init } of w.calls) {
    assert.ok(url.startsWith(`${CLOUD}/api/`), url);
    assert.equal(init.credentials, "include");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers.origin, CLOUD, "a change proves it comes from My Cloud's own page's origin");
    assert.equal(init.headers["x-omb-background"], undefined, "a quick ask is the person using My Cloud");
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers.authorization, undefined, "no token of its own");
  }
  assert.equal(w.calls[1].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(w.calls[1].init.body), { title: "Quick asks", select: false });
  assert.deepEqual(w.saves, [[CLOUD, { botId: "m", threadId: "t-new" }]]);
  assert.equal(w.said, 0, "an awake My Cloud is not woken");
  assert.equal(w.wakes, 0);
});

test("without a verified My Cloud nothing is asked", async () => {
  const w = world({ origin: null });
  await assert.rejects(w.talk.prepare(), { name: "TalkServerError", code: "cloud-down" });
  assert.deepEqual(w.calls, []);
});

test("a session that ended signs the window in again once and asks again; a sign-in that fails says so", async () => {
  const again = world({ routes: { "GET /api/bots?messages=0": [new Response(null, { status: 401 }), Response.json(BOTS)] } });
  assert.deepEqual(await again.talk.prepare(), { botId: "m", threadId: "t-new" });
  assert.deepEqual(again.reconnects, [CLOUD]);
  assert.deepEqual(again.keys(), ["GET /api/bots?messages=0", "GET /api/bots?messages=0", "POST /api/bots/m/tasks"]);

  const refused = world({ signIn: false, routes: { "GET /api/bots?messages=0": new Response(null, { status: 401 }) } });
  await assert.rejects(refused.talk.prepare(), { name: "TalkServerError", code: "cloud-signin" });
  assert.deepEqual(refused.keys(), ["GET /api/bots?messages=0"]);

  const still = world({ routes: { "GET /api/bots?messages=0": new Response(null, { status: 401 }) } });
  await assert.rejects(still.talk.prepare(), { code: "cloud-signin" });
  assert.deepEqual(still.reconnects, [CLOUD], "signs in again once, never in a loop");
  assert.equal(still.calls.length, 2);
});

test("an awake My Cloud that doesn't answer says so", async () => {
  const w = world({ routes: { "GET /api/bots?messages=0": () => Promise.reject(new TypeError("fetch failed")) } });
  await assert.rejects(w.talk.prepare(), { code: "cloud-down" });
  assert.equal(w.wakes, 0);
});

test("an asleep My Cloud is woken at the press: waking is said, the Admin wakes it, the ask waits for it to answer", async () => {
  const w = world({ asleep: true });
  const chat = w.talk.prepare(w.waked);
  assert.equal(w.said, 1, "said at once, while the person still talks");
  assert.deepEqual(await chat, { botId: "m", threadId: "t-new" });
  assert.equal(w.wakes, 1);
  assert.deepEqual(w.keys(), ["GET /api/auth/session", "GET /api/bots?messages=0", "POST /api/bots/m/tasks"]);
  assert.equal(w.calls[0].init.credentials, "include");
  assert.equal(w.gate.asleep(), false);
});

test("two presses during one wake share it, and each is told", async () => {
  const w = world({ asleep: true });
  let told = 0;
  const first = w.talk.prepare(w.waked), second = w.talk.prepare(() => { told += 1; });
  assert.deepEqual(await Promise.all([first, second]), [{ botId: "m", threadId: "t-new" }, { botId: "m", threadId: "t-new" }]);
  assert.equal(w.wakes, 1);
  assert.deepEqual([w.said, told], [1, 1]);
  assert.equal(w.calls.filter(call => call.key === "POST /api/bots/m/tasks").length, 1);
});

test("an asleep answer to a read holds the gate, wakes My Cloud and reads once more, never in a loop", async () => {
  const w = world({ routes: { "GET /api/bots?messages=0": [asleepAnswer(), Response.json(BOTS)] } });
  assert.deepEqual(await w.talk.prepare(w.waked), { botId: "m", threadId: "t-new" });
  assert.equal(w.said, 1);
  assert.deepEqual(w.keys(), ["GET /api/bots?messages=0", "GET /api/auth/session", "GET /api/bots?messages=0", "POST /api/bots/m/tasks"]);
  assert.equal(w.gate.asleep(), false, "a woken My Cloud releases the hold");

  const twice = world({ routes: { "GET /api/bots?messages=0": asleepAnswer() } });
  await assert.rejects(twice.talk.prepare(), { code: "cloud-waking" });
  assert.equal(twice.calls.filter(call => call.key === "GET /api/bots?messages=0").length, 2, "tries once more, never in a loop");
});

test("a failure while the gate says asleep is not an asleep answer: nothing is tried again", async () => {
  const timedOut = () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
  const making = world({ routes: { "POST /api/bots/m/tasks": () => { making.gate.hold(); return timedOut(); } } });
  await assert.rejects(making.talk.prepare(making.waked), { name: "TalkServerError", code: "cloud-waking" });
  assert.deepEqual(making.keys(), ["GET /api/bots?messages=0", "POST /api/bots/m/tasks"], "a create that may have happened is never made twice");
  assert.deepEqual([making.wakes, making.said], [0, 0]);

  const reading = world({ routes: { "GET /api/bots?messages=0": () => { reading.gate.hold(); return Promise.reject(new TypeError("fetch failed")); } } });
  await assert.rejects(reading.talk.prepare(), { code: "cloud-waking" });
  assert.deepEqual(reading.keys(), ["GET /api/bots?messages=0"]);
});

test("an asleep answer to the chat's creation is not repeated", async () => {
  const w = world({ routes: { "POST /api/bots/m/tasks": asleepAnswer() } });
  await assert.rejects(w.talk.prepare(), { code: "cloud-waking" });
  assert.equal(w.calls.filter(call => call.key === "POST /api/bots/m/tasks").length, 1);
  assert.equal(w.wakes, 0);
});

test("home moving elsewhere while the window signs in again asks nothing more", async () => {
  const w = world({ routes: { "GET /api/bots?messages=0": new Response(null, { status: 401 }) } });
  w.onReconnect = () => { w.origin = "https://other.example.test"; };
  await assert.rejects(w.talk.prepare(), { name: "TalkServerError", code: "cloud-down" });
  assert.deepEqual(w.keys(), ["GET /api/bots?messages=0"]);
  const gone = world({ routes: { "GET /api/bots?messages=0": new Response(null, { status: 401 }) } });
  gone.onReconnect = () => { gone.origin = null; };
  await assert.rejects(gone.talk.prepare(), { code: "cloud-down" });
  assert.equal(gone.calls.length, 1);
});

test("a wake that fails or takes too long says so, and nothing is asked", async () => {
  const silent = world({ asleep: true, wake: async () => null, routes: { "GET /api/auth/session": () => Promise.reject(new TypeError("fetch failed")) } });
  await assert.rejects(silent.talk.prepare(silent.waked), { name: "TalkServerError", code: "wake-failed" });
  assert.deepEqual(silent.keys(), ["GET /api/auth/session"]);
  assert.equal(silent.said, 1);

  const sleepy = world({ asleep: true, routes: { "GET /api/auth/session": asleepAnswer() } });
  await assert.rejects(sleepy.talk.prepare(), { code: "wake-failed" });

  let started;
  const slow = world({ asleep: true, wake: () => new Promise(resolve => { started = resolve; }), timing: { requestMs: 1_000, wakeMs: 20 } });
  await assert.rejects(slow.talk.prepare(), { code: "wake-failed" });
  assert.equal(slow.calls.length, 0);
  started(null);
  await flush();
  assert.equal(slow.calls.filter(call => call.key === "GET /api/bots?messages=0").length, 0, "a wake given up on asks nothing later");
});

test("an ask listens on My Cloud's event stream, sends once after hello and follows the reply", async () => {
  const w = world();
  const updates = [];
  const asking = w.talk.ask({ chat: { botId: "m", threadId: "t1" }, text: "hi", sendId: "send-1", signal: new AbortController().signal, onUpdate: update => updates.push(update.kind) });
  await flush();
  assert.deepEqual(w.keys(), ["GET /api/events?screens=off"]);
  assert.equal(w.calls[0].init.credentials, "include");
  w.events.push({ kind: "hello" });
  await flush();
  assert.deepEqual(w.keys(), ["GET /api/events?screens=off", "POST /api/bots/m/messages"]);
  assert.deepEqual(JSON.parse(w.calls[1].init.body), { text: "hi", threadId: "t1", sendId: "send-1" });
  assert.equal(w.calls[1].init.headers.origin, CLOUD);
  const message = (role, fields) => ({ kind: "message", threadId: "t1", message: { id: role, role, kind: "text", ...fields } });
  w.events.push(message("user", { text: "hi", sendId: "send-1" }));
  w.events.push(message("bot", { text: "Hello" }));
  w.events.push({ kind: "runtime", event: { type: "turn.completed", threadId: "t1", ok: true } });
  assert.equal(await asking, "done");
  assert.deepEqual(updates, ["thinking", "reply", "done"]);
  assert.equal(w.calls.filter(call => call.key === "POST /api/bots/m/messages").length, 1);
});

test("a send refused for an ended session signs in again and posts the same message once more", async () => {
  const w = world({ routes: { "POST /api/bots/m/messages": [new Response(null, { status: 401 }), Response.json({ ok: true }, { status: 202 })] } });
  const controller = new AbortController();
  const asking = w.talk.ask({ chat: { botId: "m", threadId: "t1" }, text: "hi", sendId: "send-1", signal: controller.signal, onUpdate: () => {} });
  await flush();
  w.events.push({ kind: "hello" });
  await flush();
  const posts = w.calls.filter(call => call.key === "POST /api/bots/m/messages");
  assert.equal(posts.length, 2);
  assert.equal(posts[0].init.body, posts[1].init.body, "the same send id, which My Cloud takes once");
  assert.deepEqual(w.reconnects, [CLOUD]);
  controller.abort();
  await assert.rejects(asking, { name: "AbortError" });
  assert.equal(w.events.cancelled, true);
});
