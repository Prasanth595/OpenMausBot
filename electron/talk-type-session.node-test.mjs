import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { TalkServerError } from "./talk-server.mjs";
import { TALK_TEXT, TYPE_TEXT, TYPE_TIMING, createTalkSession } from "./talk-session.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));
const pick = (object, keys) => Object.fromEntries(keys.map(key => [key, object[key]]));

test.beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "Date"] }));
test.afterEach(() => mock.timers.reset());

const CHAT = { botId: "m", threadId: "t1" };
function harness({ busy = false, prepare = async () => CHAT, ask } = {}) {
  const h = { views: [], closed: 0, typed: [], typeClosed: 0, focused: 0, openFails: false, blurOnClose: false, starts: [], stops: [], opened: [], asks: [], prepares: 0, sink: null };
  h.session = createTalkSession({
    speech: {
      start: (sink, options) => { h.sink = sink; h.starts.push(options); },
      stop: sink => h.stops.push(sink === h.sink),
      finish: () => {},
    },
    server: {
      prepare: onWaking => { h.prepares += 1; return prepare(onWaking); },
      ask: ask ?? (async input => { h.asks.push(input); input.onUpdate({ kind: "thinking" }); input.onUpdate({ kind: "reply", text: "Hi" }); input.onUpdate({ kind: "done", ok: true, text: "Hi" }); return "done"; }),
    },
    panel: {
      render: view => { h.views.push(view); },
      close: () => { h.closed += 1; },
      hovered: () => false,
    },
    typeBox: {
      open: view => { h.typed.push(view); if (h.openFails) throw new Error("no box"); },
      close: () => { h.typeClosed += 1; if (h.blurOnClose) h.session.typeBlurred(); },
      focus: () => { h.focused += 1; },
    },
    voiceInUse: () => busy,
    release: () => ["control", "option"],
    openChat: chat => h.opened.push(chat), newSendId: () => "send-1",
  });
  return h;
}
const say = (h, text) => h.sink.transcript({ text, partial: true });
const release = (h, info = { code: 0, reason: "completed" }) => h.sink.end(info);
const holdAsk = updates => {
  const inputs = [];
  const ask = async input => {
    inputs.push(input);
    for (const update of updates) input.onUpdate(update);
    return new Promise(() => {});
  };
  return { inputs, ask };
};

test("type timings and the typed server-down line are fixed", () => {
  assert.deepEqual(TYPE_TIMING, { idleMs: 60_000, draftMs: 300_000, repeatMs: 500 });
  assert.deepEqual(TYPE_TEXT, { serverDown: "Couldn't reach MausBot. Try again in a moment." });
  assert.ok(Object.isFrozen(TYPE_TIMING) && Object.isFrozen(TYPE_TEXT));
});

test("⌃⌥T opens an empty box; Return sends exactly the typed words to Quick asks, echoed through talk's states", async () => {
  const h = harness(); const words = "what's on\n today ";
  h.session.typePress();
  assert.deepEqual([h.typed, h.prepares], [[{ text: "" }], 0]);
  h.session.typeInput("what's on"); h.session.typeSend(words); await flush();
  assert.equal(h.typeClosed, 1);
  assert.deepEqual(pick(h.asks[0], ["chat", "text", "sendId"]), { chat: CHAT, text: words, sendId: "send-1" });
  assert.deepEqual([...new Set(h.views.map(v => v.state))], ["sending", "thinking", "reply"]);
  assert.deepEqual([h.views[0], h.views.at(-1)], [{ state: "sending", text: "", echo: words }, { state: "reply", text: "Hi", echo: words }]);
  assert.ok(h.views.every(v => v.echo === words));
  mock.timers.tick(12_000); assert.equal(h.closed, 1);
});

test("Return on a blank box does nothing, and the box stays", () => {
  const h = harness(); h.session.typePress(); h.session.typeInput("  \n ");
  h.session.typeSend("  \n ");
  assert.deepEqual([h.prepares, h.typeClosed, h.views.length, h.session.busy()], [0, 0, 0, true]);
});

test("Esc keeps no draft, and neither does the blur that follows Esc or Return", async () => {
  const h = harness();
  h.session.typePress(); h.session.typeInput("never mind"); h.session.typeCancel(); h.session.typeBlurred();
  assert.deepEqual([h.typeClosed, h.prepares], [1, 0]);
  mock.timers.tick(1_000); h.session.typePress();
  assert.deepEqual(h.typed.at(-1), { text: "" });
  h.session.typeInput("ask this"); h.session.typeSend("ask this"); h.session.typeBlurred(); await flush();
  mock.timers.tick(12_000); h.session.typePress();
  assert.deepEqual(h.typed.at(-1), { text: "" });
});

test("a blur the box's own close reports at once keeps no draft and never stops the ask", async () => {
  const h = harness(); h.blurOnClose = true;
  h.session.typePress(); h.session.typeInput("ask this"); h.session.typeSend("ask this"); await flush();
  assert.deepEqual([h.asks.length, h.views.at(-1)], [1, { state: "reply", text: "Hi", echo: "ask this" }]);
  mock.timers.tick(12_000); h.session.typePress(); h.session.typeInput("never mind"); h.session.typeCancel();
  mock.timers.tick(1_000); h.session.typePress();
  assert.deepEqual(h.typed.at(-1), { text: "" });
});

test("clicking away closes the box and keeps the words for 5 minutes", () => {
  const h = harness();
  h.session.typePress(); h.session.typeInput("half a thought"); h.session.typeBlurred();
  assert.equal(h.typeClosed, 1);
  mock.timers.tick(299_999); h.session.typePress();
  assert.deepEqual(h.typed.at(-1), { text: "half a thought" });
  h.session.typeBlurred();
  mock.timers.tick(300_000); h.session.typePress();
  assert.deepEqual(h.typed.at(-1), { text: "" });
});

test("⌃⌥T on an open box closes it when blank and gives it focus back when it holds words", () => {
  const h = harness();
  h.session.typePress(); mock.timers.tick(500); h.session.typeInput("keep"); h.session.typePress();
  assert.deepEqual([h.typeClosed, h.focused], [0, 1]);
  mock.timers.tick(500); h.session.typeInput(" "); h.session.typePress();
  assert.deepEqual([h.typeClosed, h.focused], [1, 1]);
});

test("a ⌃⌥T within 500 ms of the last one is a key repeat: one box stays open", () => {
  const h = harness();
  h.session.typePress(); mock.timers.tick(300); h.session.typePress(); mock.timers.tick(400); h.session.typePress();
  assert.deepEqual([h.typed.length, h.typeClosed], [1, 0]);
  mock.timers.tick(500); h.session.typePress();
  assert.equal(h.typeClosed, 1);
});

test("a blank box closes itself after 60 s; words stop the clock and clearing them starts it again", () => {
  const h = harness();
  h.session.typePress(); mock.timers.tick(59_999); assert.equal(h.typeClosed, 0);
  mock.timers.tick(1); assert.equal(h.typeClosed, 1);
  mock.timers.tick(1_000); h.session.typePress(); h.session.typeInput("a");
  mock.timers.tick(120_000); assert.equal(h.typeClosed, 1);
  h.session.typeInput(""); mock.timers.tick(60_000); assert.equal(h.typeClosed, 2);
});

test("a typed ask sent before the box reported any words is never closed by the idle minute", async () => {
  const { ask } = holdAsk([{ kind: "thinking" }]);
  const h = harness({ ask });
  h.session.typePress(); h.session.typeSend("hi"); await flush();
  mock.timers.tick(60_000);
  assert.deepEqual([h.closed, h.typeClosed, h.views.at(-1).state, h.session.busy()], [0, 1, "thinking", true]);
});

test("a box that fails to open keeps the draft it would have shown, on the draft's own clock", () => {
  const h = harness();
  h.session.typePress(); h.session.typeInput("half"); h.session.typeBlurred();
  mock.timers.tick(1_000); h.openFails = true; h.session.typePress();
  h.openFails = false; mock.timers.tick(1_000); h.session.typePress();
  assert.deepEqual(h.typed.map(view => view.text), ["", "half", "half"]);
  h.session.typeBlurred(); mock.timers.tick(1_000); h.openFails = true; h.session.typePress();
  h.openFails = false; mock.timers.tick(299_000); h.session.typePress();
  assert.deepEqual(h.typed.at(-1), { text: "" });
});

test("one ask at a time: ⌃⌥T waits while talk listens or an ask is on its way, and ⌃⌥Space waits while the box takes words or a typed ask is on its way", async () => {
  const { ask } = holdAsk([]);
  const h = harness({ ask });
  h.session.press(); h.session.typePress();
  say(h, "hello"); release(h); await flush();
  mock.timers.tick(600); h.session.typePress();
  assert.equal(h.typed.length, 0);
  const t = harness({ ask });
  t.session.typePress(); t.session.press();
  t.session.typeSend("hi"); await flush(); t.session.press();
  assert.deepEqual([t.starts.length, t.session.busy()], [0, true]);
});

test("⌃⌥T over a reply opens a fresh box; ⌃⌥Space over a typed reply listens", async () => {
  const h = harness();
  h.session.press(); say(h, "hi"); release(h); await flush();
  h.session.typePress();
  assert.deepEqual([h.closed, h.typed.length], [1, 1]);
  h.session.typeSend("and you?"); await flush();
  h.session.press();
  assert.deepEqual([h.closed, h.views.at(-1)], [2, { state: "listening", text: "" }]);
});

test("a typed ask gets talk's refusals with its words echoed; this computer's server down says Couldn't reach MausBot", async () => {
  for (const [code, text] of [["server-down", TYPE_TEXT.serverDown], ["starting", TALK_TEXT.starting], ["no-mausbot", TALK_TEXT.noMausbot], ["moved", TALK_TEXT.moved],
    ["cloud-down", TALK_TEXT.cloudDown], ["cloud-waking", TALK_TEXT.cloudWaking], ["wake-failed", TALK_TEXT.wakeFailed], ["cloud-signin", TALK_TEXT.cloudSignIn]]) {
    const h = harness({ prepare: async () => { throw new TalkServerError(code); } });
    h.session.typePress(); h.session.typeSend("hi"); await flush();
    assert.deepEqual(h.views.at(-1), { state: "error", text, echo: "hi" }, code);
    mock.timers.tick(4_000); assert.equal(h.closed, 1, code);
  }
});

test("a typed ask that wakes My Cloud says so under the echo, then sends once", async () => {
  let wake, ready;
  const h = harness({ prepare: onWaking => { wake = onWaking; return new Promise(resolve => { ready = resolve; }); } });
  h.session.typePress(); h.session.typeSend("hi"); wake();
  assert.deepEqual(h.views.at(-1), { state: "waking", text: "", echo: "hi" });
  ready(CHAT); await flush();
  assert.deepEqual(h.views.map(v => v.state).slice(0, 3), ["sending", "waking", "sending"]);
  assert.equal(h.asks.length, 1);
});

test("the box's words, send, cancel and blur do nothing with no box open; a box that fails to open leaves ⌃⌥T working", () => {
  const h = harness();
  h.session.typeInput("x"); h.session.typeSend("x"); h.session.typeCancel(); h.session.typeBlurred();
  assert.deepEqual([h.prepares, h.typeClosed, h.views.length], [0, 0, 0]);
  h.openFails = true; h.session.typePress();
  assert.equal(h.session.busy(), false);
  h.openFails = false; mock.timers.tick(500); h.session.typePress();
  assert.deepEqual([h.typed.length, h.session.busy()], [2, true]);
});

test("busy while the box takes words, so a quiet update waits; quitting closes the box", () => {
  const h = harness(); h.session.typePress();
  assert.equal(h.session.busy(), true);
  h.session.close();
  assert.deepEqual([h.typeClosed, h.session.busy()], [1, false]);
});

test("clicking a typed reply opens its Quick asks chat", async () => {
  const h = harness(); h.session.typePress(); h.session.typeSend("hi"); await flush();
  h.session.open();
  assert.deepEqual(h.opened, [CHAT]);
});
