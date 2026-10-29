import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { TALK_BOX_THEME_CSS, TALK_PANEL, isTalkPanel } from "./talk-panel.mjs";
import { TYPE_BOX_TEXT, blockedChord, createTypeBox, typeBoxHtml, typeBoxKey } from "./talk-type-box.mjs";

const flush = () => new Promise(resolve => setImmediate(resolve));
const pick = (object, keys) => Object.fromEntries(keys.map(key => [key, object[key]]));

const APP_ICON = fileURLToPath(new URL("./resources/app-icon.png", import.meta.url));

function harness({ cursor = { x: 100, y: 100 }, workArea = { x: 0, y: 25, width: 1440, height: 875 }, loadFails = false, startFails = false, theme } = {}) {
  const made = [];
  const nativeImage = {
    createFromPath: path => ({
      isEmpty: () => !existsSync(path),
      resize: size => ({ toPNG: () => Buffer.from(`png ${size.width}x${size.height}`) }),
    }),
  };
  class FakeBrowserWindow {
    constructor(options) {
      const { x, y, width, height } = options;
      Object.assign(this, { options, url: "", bounds: { x, y, width, height }, calls: [], destroyed: false, openHandler: null });
      this.webContents = Object.assign(new EventEmitter(), {
        scripts: [],
        executeJavaScript: async script => {
          this.webContents.scripts.push(script);
          if (startFails) throw new Error("start failed");
          return 96;
        },
        setWindowOpenHandler: handler => { this.openHandler = handler; },
      });
      this.events = new EventEmitter();
      made.push(this);
    }
    on(...args) { this.events.on(...args); }
    setAlwaysOnTop(...args) { this.calls.push(["setAlwaysOnTop", ...args]); }
    setVisibleOnAllWorkspaces(...args) { this.calls.push(["setVisibleOnAllWorkspaces", ...args]); }
    setBounds(bounds) { this.bounds = bounds; this.calls.push(["setBounds", bounds]); }
    getBounds() { return this.bounds; }
    show() { this.calls.push(["show"]); }
    focus() { this.calls.push(["focus"]); }
    moveTop() { this.calls.push(["moveTop"]); }
    showInactive() { this.calls.push(["showInactive"]); }
    loadURL(url) { this.url = url; return loadFails ? Promise.reject(new Error("load failed")) : Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const screen = { getCursorScreenPoint: () => cursor, getDisplayNearestPoint: () => ({ workArea }) };
  const events = [];
  const box = createTypeBox({
    BrowserWindow: FakeBrowserWindow,
    screen,
    nativeImage,
    iconPath: APP_ICON,
    theme,
    onInput: text => events.push(["input", text]),
    onSend: text => events.push(["send", text]),
    onCancel: () => events.push(["cancel"]),
    onBlur: () => events.push(["blur"]),
  });
  return { box, made, events };
}

const SHOWING = ["show", "showInactive", "focus", "moveTop"];
const shown = win => win.calls.map(c => c[0]).filter(n => SHOWING.includes(n));
const prevent = () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });

test("the type box is a focusable panel on every Space, made key only after it shows inactive", async () => {
  const { box, made } = harness({ cursor: { x: 2000, y: 500 }, workArea: { x: 1440, y: 25, width: 1440, height: 875 } });
  box.open({ text: "" });
  const win = made[0];
  assert.deepEqual(pick(win.options, ["type", "focusable", "transparent", "frame", "skipTaskbar", "hasShadow", "resizable", "movable", "fullscreenable", "show", "acceptFirstMouse", "hiddenInMissionControl"]),
    { type: "panel", focusable: true, transparent: true, frame: false, skipTaskbar: true, hasShadow: false, resizable: false, movable: false, fullscreenable: false, show: false, acceptFirstMouse: true, hiddenInMissionControl: true });
  assert.deepEqual(pick(win.options.webPreferences, ["contextIsolation", "sandbox", "nodeIntegration", "spellcheck"]), { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false });
  assert.ok(win.options.webPreferences.preload.endsWith("talk-type-box-preload.cjs"));
  assert.ok(isTalkPanel(win) && win.excludedFromShownWindowsMenu === true);
  assert.deepEqual(win.calls.filter(c => c[0] !== "setBounds"), [["setAlwaysOnTop", true, "screen-saver"], ["setVisibleOnAllWorkspaces", true, { visibleOnFullScreen: true, skipTransformProcessType: true }]]);
  win.webContents.emit("did-finish-load"); await flush();
  assert.equal(win.webContents.scripts[0], 'start({"text":""})');
  assert.deepEqual(win.bounds, { x: 1960, y: 780, width: 400, height: 96 });
  assert.deepEqual(shown(win), ["showInactive", "focus"]);
});

test("a draft opens with its words in the app's skin", async () => {
  const { box, made } = harness({ theme: "dark" });
  box.open({ text: "half" }); made[0].webContents.emit("did-finish-load"); await flush();
  assert.equal(made[0].webContents.scripts[0], 'start({"text":"half","theme":"dark"})');
});

test("closing gives up focus at once: destroyed with no fade, and its blur and late messages are never reported", async () => {
  const { box, made, events } = harness();
  box.open({ text: "draft" }); made[0].webContents.emit("did-finish-load"); await flush();
  box.close();
  assert.equal(made[0].destroyed, true);
  assert.ok(!made[0].webContents.scripts.includes("fadeOut()"));
  made[0].events.emit("blur");
  made[0].webContents.emit("ipc-message", {}, "type-box:send", "late");
  assert.deepEqual(events, []);
});

test("a box that loses focus, or can't start its page, says so once; a second open replaces the first", async () => {
  const { box, made, events } = harness();
  box.open({ text: "" }); made[0].events.emit("blur");
  assert.deepEqual(events, [["blur"]]);
  box.open({ text: "" });
  assert.deepEqual([made[0].destroyed, made.length], [true, 2]);
  made[0].events.emit("blur");
  assert.equal(events.length, 1);
  const failing = harness({ startFails: true });
  failing.box.open({ text: "x" }); failing.made[0].webContents.emit("did-finish-load"); await flush();
  assert.deepEqual([failing.made[0].destroyed, failing.events, shown(failing.made[0])], [true, [["blur"]], []]);
});

test("the page's messages count only from this box, and only when well formed", () => {
  const { box, made, events } = harness();
  box.open({ text: "" });
  const page = made[0].webContents;
  page.emit("ipc-message", {}, "type-box:input", "hi", 120);
  page.emit("ipc-message", {}, "type-box:input", { text: "hi" }, 130);
  page.emit("ipc-message", {}, "type-box:send", "x".repeat(4001));
  page.emit("ipc-message", {}, "type-box:send", 42);
  page.emit("ipc-message", {}, "type-box:send", "x".repeat(4000));
  page.emit("ipc-message", {}, "type-box:cancel");
  page.emit("ipc-message", {}, "talk-panel:open");
  assert.deepEqual(events, [["input", "hi"], ["send", "x".repeat(4000)], ["cancel"]]);
  assert.equal(made[0].bounds.height, 120);
  page.emit("ipc-message", {}, "type-box:input", "hi", 900);
  page.emit("ipc-message", {}, "type-box:input", "hi", Number.NaN);
  assert.equal(made[0].bounds.height, 240);
  const preload = readFileSync(new URL("./talk-type-box-preload.cjs", import.meta.url), "utf8");
  assert.deepEqual([...preload.matchAll(/ipcRenderer\.(\w+)\("([^"]+)"/g)].map(m => [m[1], m[2]]),
    [["send", "type-box:input"], ["send", "type-box:send"], ["send", "type-box:cancel"]]);
});

test("⌘ chords other than editing ones never reach the page or the app's menu", () => {
  const cmd = (key, more = {}) => ({ type: "keyDown", key, meta: true, ...more });
  for (const key of ["q", "w", "r", ",", "h", "m", "n", "0", "=", "`", "ˆ"]) assert.equal(blockedChord(cmd(key)), true, key);
  for (const input of [cmd("a"), cmd("c"), cmd("v"), cmd("x"), cmd("z"), cmd("Z", { shift: true }), cmd("ArrowLeft"), cmd("Backspace"), cmd("Enter"),
    { type: "keyDown", key: "q" }, { type: "keyDown", key: "a", control: true }, { type: "keyUp", key: "q", meta: true }]) {
    assert.equal(blockedChord(input), false, JSON.stringify(input));
  }
  const { box, made } = harness();
  box.open({ text: "" });
  const stopped = input => { const event = prevent(); made[0].webContents.emit("before-input-event", event, input); return event.defaultPrevented; };
  assert.deepEqual([stopped(cmd("q")), stopped(cmd("v"))], [true, false]);
});

test("on a non-Latin layout the physical key names the chord, so ⌘C copies on Russian and ⌥⌘I's dead key is still caught", () => {
  const cmd = (key, code, more = {}) => ({ type: "keyDown", key, code, meta: true, ...more });
  assert.equal(blockedChord(cmd("с", "KeyC")), false);
  assert.equal(blockedChord(cmd("й", "KeyQ")), true);
  assert.equal(blockedChord(cmd("Dead", "KeyI", { alt: true })), true);
  assert.equal(blockedChord(cmd("Z", "KeyZ", { shift: true })), false);
  assert.equal(blockedChord(cmd("ArrowLeft", "ArrowLeft")), false);
  assert.equal(blockedChord(cmd("Backspace", "Backspace")), false);
  assert.equal(blockedChord(cmd("Dead", "BracketLeft", { alt: true })), true);
  assert.equal(blockedChord(cmd("q", "KeyA")), true, "AZERTY's ⌘Q is the key at A, and macOS quits on the character");
  assert.equal(blockedChord(cmd("a", "KeyQ")), false, "AZERTY's ⌘A is the key at Q");
  assert.deepEqual(["q", "c", "ˆ", "ArrowLeft"].map(key => blockedChord({ type: "keyDown", key, meta: true })), [true, false, true, false], "with no code, the key decides");
});

test("navigation and new windows are refused; the page is plain text under talk's policy and colours", () => {
  const { box, made } = harness();
  box.open({ text: "" });
  const event = prevent();
  made[0].webContents.emit("will-navigate", event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(made[0].openHandler(), { action: "deny" });
  const html = typeBoxHtml("AAAA");
  assert.match(html, /default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"/);
  assert.match(html, /<textarea id="field"[^>]*maxlength="4000"/);
  assert.ok(html.includes(TALK_BOX_THEME_CSS));
  assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|outerHTML|https?:\/\//);
});

test("a page that never loads says so once and is destroyed, with no unhandled rejection", async () => {
  const unhandled = [];
  const record = reason => unhandled.push(reason);
  process.on("unhandledRejection", record);
  try {
    const { box, made, events } = harness({ loadFails: true });
    box.open({ text: "" });
    await flush();
    assert.deepEqual([made[0].destroyed, events, shown(made[0])], [true, [["blur"]], []]);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", record);
  }
});

function runPage(html) {
  const script = /<script>([\s\S]*)<\/script>/.exec(html)[1];
  const calls = [];
  const listeners = {};
  const element = id => ({
    id, value: "", readOnly: false, style: {}, scrollHeight: 18, selection: null,
    addEventListener(type, handler) { (listeners[`${id}:${type}`] ??= []).push(handler); },
    focus() {},
    setSelectionRange(a, b) { this.selection = [a, b]; },
    getBoundingClientRect: () => ({ height: 56 }),
  });
  const elements = { card: element("card"), field: element("field"), close: element("close") };
  const body = { className: "" };
  const context = {
    document: { getElementById: id => elements[id], body },
    window: { typeBox: {
      input: (text, height) => calls.push(["input", text, height]),
      send: text => calls.push(["send", text]),
      cancel: () => calls.push(["cancel"]),
    } },
  };
  context.window.window = context.window;
  runInNewContext(script, context);
  const fire = (id, type, init = {}) => {
    const event = { ...init, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const handler of listeners[`${id}:${type}`] ?? []) handler(event);
    return event;
  };
  return { start: context.start, field: elements.field, body, calls, fire, key: init => fire("field", "keydown", init) };
}

test("Return sends, Shift+Return makes a line, Esc closes; while an input method composes, both only finish the composition", () => {
  assert.equal(typeBoxKey({ key: "Enter" }), "send");
  assert.equal(typeBoxKey({ key: "Enter", shiftKey: true }), null);
  assert.equal(typeBoxKey({ key: "Escape" }), "cancel");
  assert.equal(typeBoxKey({ key: "Enter", isComposing: true }), null);
  assert.equal(typeBoxKey({ key: "Enter", keyCode: 229 }), null);
  assert.equal(typeBoxKey({ key: "Escape", isComposing: true }), null);
  assert.equal(typeBoxKey({ key: "a" }), null);
  assert.ok(typeBoxHtml("AAAA").includes(String(typeBoxKey)), "the page runs this rule, not a copy of it");
});

test("the page sends only words, once, then stops taking typing", () => {
  const page = runPage(typeBoxHtml("AAAA"));
  assert.equal(typeof page.start({ text: "half", theme: "dark" }), "number");
  assert.deepEqual([page.field.value, page.field.selection, page.body.className], ["half", [4, 4], "on dark"]);
  page.field.value = "  \n ";
  assert.equal(page.key({ key: "Enter" }).defaultPrevented, true, "a blank Return types no line either");
  assert.equal(page.key({ key: "Enter", shiftKey: true }).defaultPrevented, false);
  page.field.value = "日本";
  assert.equal(page.key({ key: "Enter", isComposing: true }).defaultPrevented, false);
  assert.deepEqual(page.calls, []);
  page.field.value = "what's on\ntoday";
  page.key({ key: "Enter" }); page.key({ key: "Enter" });
  assert.deepEqual(page.calls, [["send", "what's on\ntoday"]]);
  assert.equal(page.field.readOnly, true);
});

test("Esc and × close; every change reports the words and the card's height", () => {
  const page = runPage(typeBoxHtml("AAAA"));
  page.start({ text: "" });
  page.field.value = "abc"; page.fire("field", "input");
  page.key({ key: "Escape" }); page.fire("close", "click");
  assert.deepEqual(page.calls, [["input", "abc", 56], ["cancel"], ["cancel"]]);
});

test("the field grows to six lines, then scrolls, inside the tallest box, and says what it is for", () => {
  const html = typeBoxHtml("AAAA");
  assert.match(html, /<textarea id="field"[^>]*rows="1"[^>]*maxlength="4000"/);
  assert.match(html, /#field\{[^}]*max-height:calc\(6 \* 1\.4em\)[^}]*overflow-y:auto/);
  assert.match(html, /placeholder="Type to MausBot, then press Return"/);
  assert.match(html, /aria-label="Ask MausBot"/);
  assert.match(html, /<button id="close" type="button" aria-label="Dismiss"/);
  assert.ok(28 + 2 + 6 * 18.2 <= TALK_PANEL.maxHeight);
  assert.deepEqual(TYPE_BOX_TEXT, { placeholder: "Type to MausBot, then press Return", label: "Ask MausBot", dismiss: "Dismiss" });
});
