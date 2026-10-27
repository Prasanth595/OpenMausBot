import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import { TALK_SHORTCUT_UNAVAILABLE } from "./talk-shortcut.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "main.mjs"), "utf8").replace(/\r\n/g, "\n");
const preload = readFileSync(join(here, "preload.cjs"), "utf8");

function slice(from, until) {
  const start = main.indexOf(from), last = main.indexOf(until, start);
  assert.ok(start >= 0 && last > start, `main.mjs has ${from} … ${until}`);
  return main.slice(start, last + until.length);
}

function talkWiring({ session = {}, sessionFails = false } = {}) {
  const seen = { log: [], links: [], reveals: 0, closed: 0, panelOptions: null, shortcutOptions: null, sessionOptions: null };
  const context = vm.createContext({
    BrowserWindow: {}, screen: {}, APP_ICON: "icon.png", globalShortcut: {}, desktopPrefs: {}, nativeActions: { appleSpeech: true }, desktopRemoteAccess: null,
    startSpeech() {}, stopSpeech() {}, finishSpeech() {}, speechBusy: () => false, callPresence: { active: () => false },
    app: { isPackaged: true }, runningDataDir: "/data", DEV_URL: "http://dev", talkRequest() {}, createTalkServer: () => ({}),
    createTalkPanel: options => { seen.panelOptions = options; return {}; },
    createTalkShortcut: options => { seen.shortcutOptions = options; return { close: () => { seen.closed += 1; } }; },
    createTalkSession: options => { seen.sessionOptions = options; if (sessionFails) throw new Error("no session"); return session; },
    queueChatLink: link => { seen.links.push(link); }, revealForLink: () => { seen.reveals += 1; }, slog: line => { seen.log.push(line); },
  });
  vm.runInContext("let talkShortcut = null, talkSession = null;", context);
  vm.runInContext(slice("  const logged = (what, run) => () => {", "slog(`talk shortcut unavailable: ${error?.message ?? error}`);\n  }\n"), context);
  seen.value = name => vm.runInContext(name, context);
  return seen;
}

test("every list of the app's windows leaves the talk box out", () => {
  assert.equal(main.match(/BrowserWindow\.getAllWindows\(\)/g).length, 1);
  assert.match(main, /function appWindows\(\) \{\s*return BrowserWindow\.getAllWindows\(\)\.filter\(\(win\) => !isTalkPanel\(win\)\);/);
  assert.match(main, /if \(appWindows\(\)\.length === 0\) openWindowForLink\(\);/);
  assert.match(main, /allWindows: \(\) => appWindows\(\)/);
});

test("the talk setting answers only this computer's page; a call can be reported from My Cloud's page too", () => {
  for (const channel of ["talk-shortcut:state", "talk-shortcut:set"]) assert.match(main, new RegExp(`ipcMain\\.handle\\("${channel}", localOnly\\("${channel}"`));
  assert.match(main, /ipcMain\.handle\("call:active", localOrHome\("call:active"/);
  const list = name => preload.match(new RegExp(`const ${name} = (?:new Set\\()?\\[([^\\]]*)\\]`))[1];
  assert.doesNotMatch(list("REMOTE_SAFE"), /talkShortcut|callActive/);
  assert.match(list("HOME_PAGE"), /"callActive"/);
  assert.doesNotMatch(list("HOME_PAGE"), /talkShortcut/);
});

test("a page's speech stop and finish touch only the session that page started", () => {
  assert.match(main, /stopSpeech\(BrowserWindow\.fromWebContents\(event\.sender\)\)/);
  assert.match(main, /finishSpeech\(BrowserWindow\.fromWebContents\(event\.sender\)\)/);
});

test("the talk box asks this computer's own server: the app's in a build, the dev server through Vite in development", () => {
  assert.match(main, /const talkRequest = \(route, init\) => \(app\.isPackaged \? localServerRequest\(route, init\) : fetch\(new URL\(route, DEV_URL\), init\)\);/);
  assert.match(main, /createTalkServer\(\{ request: talkRequest,/);
  assert.match(main, /available: \(\) => nativeActions\.appleSpeech && !desktopRemoteAccess/);
});

test("the talk box can finish its own speech, and waits while a call or composer dictation holds the microphone", () => {
  assert.match(main, /speech: \{ start: startSpeech, stop: stopSpeech, finish: finishSpeech, busy: speechBusy \}/);
  assert.match(main, /voiceInUse: \(\) => speechBusy\(\) \|\| callPresence\.active\(\)/);
});

test("before the shortcut is set up its setting says unavailable; a change passes on only what main understands", () => {
  const handlers = new Map(), reported = [], changes = [];
  const context = vm.createContext({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    localOnly: (_channel, handler) => handler, localOrHome: (_channel, handler) => handler,
    createCallPresence: () => ({ set: (sender, active) => reported.push([sender, active]) }),
    TALK_SHORTCUT_UNAVAILABLE,
  });
  vm.runInContext(slice("const callPresence = createCallPresence();", "callPresence.set(event.sender, active === true);\n}));\n"), context);
  assert.equal(handlers.get("talk-shortcut:state")({}), TALK_SHORTCUT_UNAVAILABLE);
  assert.equal(handlers.get("talk-shortcut:set")({}, { enabled: false }), TALK_SHORTCUT_UNAVAILABLE);
  context.shortcut = { state: () => "state", set: change => { changes.push({ ...change }); return "changed"; } };
  vm.runInContext("talkShortcut = shortcut;", context);
  assert.equal(handlers.get("talk-shortcut:state")({}), "state");
  assert.equal(handlers.get("talk-shortcut:set")({}, { enabled: "no", key: 7, extra: 1 }), "changed");
  handlers.get("talk-shortcut:set")({}, { enabled: true, key: "ctrl-shift-space" });
  assert.deepEqual(changes, [{ enabled: undefined, key: undefined }, { enabled: true, key: "ctrl-shift-space" }]);
  const sender = {};
  handlers.get("call:active")({ sender }, "yes");
  handlers.get("call:active")({ sender }, true);
  assert.deepEqual(reported, [[sender, false], [sender, true]]);
});

test("a talk shortcut that cannot be set up is logged and let go, and startup goes on", () => {
  const failed = talkWiring({ sessionFails: true });
  assert.equal(failed.closed, 1);
  assert.equal(failed.value("talkShortcut"), null);
  assert.equal(failed.value("talkSession"), null);
  assert.deepEqual(failed.log, ["talk shortcut unavailable: no session"]);
});

test("a press, an open or a dismiss that throws is logged, never thrown at Electron", () => {
  const boom = () => { throw new Error("boom"); };
  const wired = talkWiring({ session: { press: boom, open: boom, dismiss: boom } });
  wired.shortcutOptions.onPress(); wired.panelOptions.onOpen(); wired.panelOptions.onDismiss();
  assert.deepEqual(wired.log, ["talk press failed: boom", "talk open failed: boom", "talk dismiss failed: boom"]);
});

test("clicking the box opens its chat by a link with both ids escaped, or else just shows MausBot", () => {
  const wired = talkWiring();
  wired.sessionOptions.openChat({ threadId: "t 1/x", botId: "b?1&x" });
  wired.sessionOptions.openChat(null);
  assert.deepEqual(wired.links, ["openmausbot://thread/t%201%2Fx?bot=b%3F1%26x"]);
  assert.equal(wired.reveals, 1);
});

test("quitting closes the talk box and frees the shortcut first", () => {
  assert.match(main, /app\.on\("before-quit", \(e\) => \{\s*talkSession\?\.close\(\); talkShortcut\?\.close\(\);/);
});
