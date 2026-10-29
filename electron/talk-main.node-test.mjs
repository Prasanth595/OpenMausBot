import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import { createCloudPowerGate } from "./cloud-power.mjs";
import { createDesktopPrefs } from "./desktop-prefs.mjs";
import { installTalk, isTalkPanel } from "./talk-main.mjs";
import { TALK_SHORTCUT_UNAVAILABLE, TYPE_SHORTCUT_UNAVAILABLE } from "./talk-shortcut.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "main.mjs"), "utf8").replace(/\r\n/g, "\n");
const preload = readFileSync(join(here, "preload.cjs"), "utf8");
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve)); };
const json = body => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
const names = windows => windows.map(win => win?.name ?? null);
const CLOUD = "https://home.example.test";
const HOME_HERE = Object.freeze({ kind: "computer" }), HOME_CLOUD = Object.freeze({ kind: "cloud", origin: CLOUD });
const talkKeys = h => [...h.registered.keys()].filter(key => key.endsWith("Space"));
const typeKeys = h => [...h.registered.keys()].filter(key => key.endsWith("+T"));
const SETTINGS = Object.freeze({
  "talk-shortcut": { unavailable: TALK_SHORTCUT_UNAVAILABLE, key: "ctrl-opt-space", other: "ctrl-shift-space", accelerator: "Control+Shift+Space", keys: talkKeys },
  "type-shortcut": { unavailable: TYPE_SHORTCUT_UNAVAILABLE, key: "ctrl-opt-t", other: "ctrl-shift-t", accelerator: "Control+Shift+T", keys: typeKeys },
});

/** `serve(route, where)`: an answer for this computer's server ("local", "dev") or My Cloud ("cloud"), else none yet. */
function harness({ packaged = true, appleSpeech = true, remote = false, register, serve = () => undefined, myCloud = true, platform = "darwin" } = {}) {
  const h = { handlers: new Map(), listeners: new Map(), guards: new Map(), started: [], stopped: [], finished: [], requests: [], links: [], reveals: 0, log: [],
    registered: new Map(), windows: [], busy: false, fail: {}, home: HOME_HERE, mine: CLOUD, cloudPower: null, wakes: 0, reconnects: [], starting: false };
  const owners = new Map();
  class FakeBrowserWindow {
    static fromWebContents(contents) { return owners.get(contents) ?? null; }
    constructor(options = {}) {
      Object.assign(this, { options, name: options.name, destroyed: false, events: new EventEmitter() });
      this.webContents = Object.assign(new EventEmitter(), { sent: [], scripts: [], setWindowOpenHandler() {} });
      this.webContents.executeJavaScript = async script => { this.webContents.scripts.push(script); return 56; };
      this.webContents.send = (...message) => { this.webContents.sent.push(message); };
      owners.set(this.webContents, this);
      h.windows.push(this);
    }
    on(...args) { this.events.on(...args); }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setBounds() {}
    getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; }
    showInactive() {}
    focus() {}
    loadURL() { return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const failing = (name, run) => (...args) => {
    if (h.fail[name]) throw new Error(h.fail[name]);
    return run(...args);
  };
  const answer = (route, where) => serve(route, where) ?? new Promise(() => {});
  // A page of another server (`remote`) is refused here as main's own guards refuse it.
  const guard = kind => (channel, handler) => {
    h.guards.set(channel, kind);
    return (event, ...args) => {
      if (event?.remote) throw new Error(`${channel} is only available in this app's window`);
      return handler(event, ...args);
    };
  };
  h.talk = installTalk({
    ipcMain: { handle: (channel, handler) => h.handlers.set(channel, handler), on: (channel, listener) => h.listeners.set(channel, listener) },
    localOnly: guard("localOnly"), localOrHome: guard("localOrHome"), cloudPage: event => event?.cloudPage === true, BrowserWindow: FakeBrowserWindow, appleSpeech,
    speech: {
      start: (target, options) => { h.started.push([target, options]); },
      stop: failing("stop", owner => { h.stopped.push(owner); }),
      finish: owner => { h.finished.push(owner); },
      busy: failing("busy", () => h.busy),
    },
    packaged, devUrl: "http://127.0.0.1:5199", iconPath: join(here, "resources", "app-icon.png"),
    nativeImage: { createFromPath: () => ({ isEmpty: () => false, resize: () => ({ toPNG: () => Buffer.from("png") }) }) },
    openLink: link => { h.links.push(link); }, reveal: failing("reveal", () => { h.reveals += 1; }), log: line => { h.log.push(line); }, platform,
    fetch: url => { h.requests.push(["dev", String(url)]); return answer(`${url.pathname}${url.search}`, "dev"); },
  });
  h.power = createCloudPowerGate({ power: () => h.cloudPower });
  const account = {
    power: () => h.cloudPower,
    wakeHome: async () => { h.wakes += 1; h.cloudPower = { state: "awake", since: 2, sleeps: true }; h.power.changed(); return "awake"; },
    setWaking: () => {},
  };
  h.cloudFetch = (url, init = {}) => {
    const at = new URL(url);
    h.requests.push(["cloud", String(url), init]);
    return answer(`${at.pathname}${at.search}`, "cloud");
  };
  const globalShortcut = {
    register: register ?? ((accelerator, press) => { h.registered.set(accelerator, press); return true; }),
    unregister: accelerator => { h.registered.delete(accelerator); },
  };
  const screen = { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 25, width: 1440, height: 875 } }) };
  h.start = () => h.talk.start({ globalShortcut, screen, prefs: createDesktopPrefs({ read: () => null, write: () => {} }), remote: () => remote,
    home: failing("home", () => h.home), starting: () => h.starting,
    localRequest: route => { h.requests.push(["local", route]); return answer(route, "local"); }, dataDir: () => "/Users/a/.openmausbot",
    ...(myCloud ? { myCloud: { mine: () => h.mine, fetch: h.cloudFetch, reconnect: async at => { h.reconnects.push(at); return false; }, power: h.power, account: () => account } } : {}) });
  h.handle = (channel, event, ...args) => h.handlers.get(channel)(event, ...args);
  h.sync = (channel, event) => { h.listeners.get(channel)(event); return event.returnValue; };
  h.where = () => h.requests.map(([where, url]) => [where, url]);
  h.press = () => h.registered.get("Control+Alt+Space")();
  h.typePress = () => h.registered.get("Control+Alt+T")();
  h.page = name => new FakeBrowserWindow({ name });
  h.box = () => h.windows.findLast(win => isTalkPanel(win));
  h.typeBox = () => h.windows.findLast(win => isTalkPanel(win) && win.options.focusable === true);
  h.click = what => h.box().webContents.emit("ipc-message", {}, `talk-panel:${what}`);
  h.painted = async () => { h.box().webContents.emit("did-finish-load"); await settle(); return h.box().webContents.scripts.filter(script => script.startsWith("render(")).map(script => JSON.parse(script.slice(7, -1))); };
  return h;
}

test("every list of the app's windows leaves the talk box out", () => {
  assert.equal(main.match(/BrowserWindow\.getAllWindows\(\)/g).length, 1);
  assert.match(main, /function appWindows\(\) \{\s*return BrowserWindow\.getAllWindows\(\)\.filter\(\(win\) => !isTalkPanel\(win\)\);/);
  assert.match(main, /if \(appWindows\(\)\.length === 0\) openWindowForLink\(\);/);
  assert.match(main, /allWindows: \(\) => appWindows\(\)/);
});

test("main hands the talk wiring its speech sinks, this computer's own server and window, and closes it first on quit", () => {
  assert.match(main, /const talk = installTalk\(\{ ipcMain, localOnly, localOrHome, cloudPage: event => cloudPageAsking\(event\) === "cloud", BrowserWindow, appleSpeech: nativeActions\.appleSpeech,\s*speech: \{ start: startSpeech, stop: stopSpeech, finish: finishSpeech, busy: speechBusy \},/);
  assert.match(main, /packaged: app\.isPackaged, devUrl: DEV_URL, nativeImage, iconPath: APP_ICON, openLink: queueChatLink, reveal: revealForLink, log: slog \}\);/);
  assert.match(main, /talk\.start\(\{ globalShortcut, screen, prefs: desktopPrefs, remote: \(\) => Boolean\(desktopRemoteAccess\), home: \(\) => homeWindow\.current\(\), starting: \(\) => !serverReady, localRequest: localServerRequest, dataDir: \(\) => runningDataDir,\s*myCloud: \{ mine: myCloud, fetch: \(\.\.\.args\) => session\.defaultSession\.fetch\(\.\.\.args\), reconnect: reconnectCloud, power: cloudPower, account: \(\) => cloudAccount \} \}\);/);
  assert.match(main, /app\.on\("before-quit", \(e\) => \{\s*talk\.close\(\);/);
  assert.doesNotMatch(main, /ipcMain\.handle\("(?:speech|talk-shortcut|type-shortcut|call):/);
});

test("main tells the talk wiring when home changes and which skin the app painted, and counts a talk ask as busy for a quiet update", () => {
  assert.match(main, /const homeWindow = createHomeWindow\(\{[^]*?rehomed: \(\) => talk\.homeChanged\(\),[^]*?\}\);\ninstallHomeWindowIpc/);
  assert.match(main, /ipcMain\.handle\("desktop:skin", \(event, skin\) => \{\s*if \(!isKnownSkin\(skin\)\) return false;\s*if \(chromeRail\.owns\(event\)\) return true;\s*try \{\s*talk\.skin\(skin\);/);
  assert.match(main, /busy: \(\) => \(oneHome\.oneHome\.busy\(\) && "move"\) \|\| \(computerSharing\?\.busy\(\) && "lending"\) \|\| \(talk\.busy\(\) && "talk"\) \|\|/);
});

test("the talk bridge keys stay off other servers' pages; a call can be reported from My Cloud's page", () => {
  const list = name => preload.match(new RegExp(`const ${name} = (?:new Set\\()?\\[([^\\]]*)\\]`))[1];
  assert.doesNotMatch(list("REMOTE_SAFE"), /talkShortcut|typeShortcut|callActive/);
  assert.match(list("HOME_PAGE"), /"callActive"/);
  assert.doesNotMatch(list("HOME_PAGE"), /talkShortcut|typeShortcut/, "a team's page is a home page too");
  assert.deepEqual(list("MY_CLOUD_PAGE"), `"talkShortcut", "typeShortcut"`);
});

/** The real preload as `origin`'s page: `home` answers home:page, `talk` answers talk-shortcut:page. */
/** Values made in the preload's own context, compared as plain data. */
const plain = value => JSON.parse(JSON.stringify(value));
function preloadAt(origin, { home = false, talk = false, activation = false } = {}) {
  let bridge; const synced = [], invoked = [];
  vm.runInNewContext(preload, {
    process: { platform: "darwin", argv: ["--omb-local-origin=http://127.0.0.1:4242"] },
    location: { origin }, navigator: { userActivation: { isActive: activation } }, TextEncoder, localStorage: { getItem: () => null }, queueMicrotask,
    require: () => ({ webUtils: {}, contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } },
      ipcRenderer: { on() {}, removeListener() {}, send() {}, invoke: (...args) => { invoked.push(args); return Promise.resolve(); },
        sendSync: channel => { synced.push(channel); return channel === "home:page" ? home : channel === "talk-shortcut:page" ? talk : null; } } }),
  });
  return { bridge, synced, invoked };
}

test("the Settings row's bridge reaches My Cloud's own page while it is home, and no other server's page", () => {
  const mine = preloadAt(CLOUD, { home: true, talk: true });
  assert.equal(typeof mine.bridge.talkShortcut?.state, "function");
  assert.ok(mine.synced.includes("talk-shortcut:page"));
  const team = preloadAt("https://team.example.test", { home: true, talk: false });
  assert.equal(team.bridge.talkShortcut, undefined, "a team's page is a home page, never the talk bridge's");
  const other = preloadAt("https://bots.example.test", { home: false, talk: true });
  assert.equal(other.bridge.talkShortcut, undefined);
  assert.equal(other.synced.includes("talk-shortcut:page"), false, "only a home page asks");
  const local = preloadAt("http://127.0.0.1:4242");
  assert.equal(typeof local.bridge.talkShortcut?.set, "function");
  assert.equal(local.synced.includes("talk-shortcut:page"), false, "this app's page never needs to ask");
});

test("on My Cloud's page, turning the shortcut on or changing its key takes the person's click; turning it off does not", async () => {
  const page = preloadAt(CLOUD, { home: true, talk: true });
  await assert.rejects(page.bridge.talkShortcut.set({ enabled: true }), /talk shortcut/);
  await assert.rejects(page.bridge.talkShortcut.set({ key: "ctrl-shift-space" }), /talk shortcut/);
  await assert.rejects(page.bridge.talkShortcut.set({ enabled: false, key: "ctrl-shift-space" }), /talk shortcut/);
  await page.bridge.talkShortcut.set({ enabled: false });
  await page.bridge.talkShortcut.state();
  assert.deepEqual(plain(page.invoked), [["talk-shortcut:set", { enabled: false }], ["talk-shortcut:state"]]);

  const clicked = preloadAt(CLOUD, { home: true, talk: true, activation: true });
  await clicked.bridge.talkShortcut.set({ enabled: true, key: "opt-shift-space", extra: 1 });
  assert.deepEqual(plain(clicked.invoked), [["talk-shortcut:set", { enabled: true, key: "opt-shift-space" }]]);

  const local = preloadAt("http://127.0.0.1:4242");
  await local.bridge.talkShortcut.set({ enabled: true });
  assert.deepEqual(plain(local.invoked), [["talk-shortcut:set", { enabled: true }]], "this app's own page needs no click");
});

for (const prefix of Object.keys(SETTINGS)) {
  test(`main lets My Cloud's own page read and change ${prefix} only while My Cloud is home, at the verified origin`, () => {
    const h = harness();
    const frame = { origin: CLOUD };
    const mine = { remote: true, cloudPage: true, senderFrame: frame }, team = { remote: true, cloudPage: false, senderFrame: { origin: "https://team.example.test" } };
    h.home = HOME_CLOUD;
    assert.equal(h.sync("talk-shortcut:page", { ...mine }), false, "nothing before the shortcut is set up");
    assert.throws(() => h.handle(`${prefix}:state`, mine), /only available/);
    h.start();
    assert.equal(h.sync("talk-shortcut:page", { ...mine }), true);
    assert.equal(h.handle(`${prefix}:state`, mine).available, true);
    assert.equal(h.handle(`${prefix}:set`, mine, { enabled: false }).enabled, false);
    assert.equal(h.handle(`${prefix}:state`, {}).enabled, false, "the same setting as this app's page");
    assert.equal(h.sync("talk-shortcut:page", { ...team }), false);
    assert.throws(() => h.handle(`${prefix}:set`, team, { enabled: true }), /only available/);
    h.mine = "https://other.example.test";
    assert.equal(h.sync("talk-shortcut:page", { ...mine }), false, "home's origin is not the verified My Cloud");
    assert.throws(() => h.handle(`${prefix}:state`, mine), /only available/);
    h.mine = CLOUD;
    h.home = HOME_HERE;
    assert.equal(h.sync("talk-shortcut:page", { ...mine }), false, "My Cloud before the move made it home");
    assert.throws(() => h.handle(`${prefix}:state`, mine), /only available/);
    h.home = { kind: "signin" };
    assert.throws(() => h.handle(`${prefix}:state`, mine), /only available/);
    h.fail.home = "home unknown";
    assert.equal(h.sync("talk-shortcut:page", { ...mine }), false);
    h.talk.close();
  });

  test(`a page whose own origin is opaque never counts as My Cloud's for ${prefix}, whatever its URL says`, () => {
    const h = harness();
    h.home = HOME_CLOUD;
    h.start();
    for (const senderFrame of [{ origin: "null", url: `${CLOUD}/files/page.html` }, { url: `${CLOUD}/` }, undefined]) {
      const event = { remote: true, cloudPage: true, senderFrame };
      assert.equal(h.sync("talk-shortcut:page", { ...event }), false, JSON.stringify(senderFrame));
      assert.throws(() => h.handle(`${prefix}:state`, event), /only available/);
      assert.throws(() => h.handle(`${prefix}:set`, event, { enabled: false }), /only available/);
    }
    h.talk.close();
  });
}

test("every microphone channel answers only this computer's page; a call can be reported from My Cloud's page too", () => {
  const { guards, handlers, listeners } = harness();
  // The talk setting's own guard (this app's page, or My Cloud's while home) is proven by the tests about My Cloud's page.
  assert.deepEqual(Object.fromEntries([...guards].filter(([channel]) => !channel.startsWith("talk-shortcut:") && !channel.startsWith("type-shortcut:"))), {
    "speech:start": "localOnly", "speech:stop": "localOnly", "speech:finish": "localOnly", "call:active": "localOrHome",
  });
  assert.deepEqual([...handlers.keys()], ["speech:start", "speech:stop", "speech:finish", "talk-shortcut:state", "talk-shortcut:set", "type-shortcut:state", "type-shortcut:set", "call:active"]);
  assert.deepEqual([...listeners.keys()], ["talk-shortcut:page"]);
});

test("a page's speech stop and finish name that page's own window, so they touch only the session it started", () => {
  const h = harness();
  const page = h.page("page"), other = h.page("other");
  h.handle("speech:start", { sender: page.webContents }, { endpointMs: 900 });
  h.handle("speech:start", { sender: {} });
  h.handle("speech:stop", { sender: other.webContents });
  h.handle("speech:finish", { sender: page.webContents });
  h.handle("speech:stop", { sender: page.webContents });
  h.handle("speech:stop", { sender: {} });
  assert.deepEqual(h.started.map(([win, options]) => [win.name, options]), [["page", { endpointMs: 900 }]]);
  assert.deepEqual(names(h.stopped), ["other", "page", null]);
  assert.deepEqual(names(h.finished), ["page"]);

  const elsewhere = harness({ appleSpeech: false });
  const win = elsewhere.page("page");
  elsewhere.handle("speech:start", { sender: win.webContents });
  elsewhere.handle("speech:stop", { sender: win.webContents });
  elsewhere.handle("speech:finish", { sender: win.webContents });
  assert.deepEqual(win.webContents.sent, [["speech:end", { code: 2, reason: "unsupported-platform" }]]);
  assert.deepEqual([elsewhere.started, elsewhere.stopped, elsewhere.finished], [[], [], []]);
});

test("the shortcut is offered only with Apple speech, on a desktop that is not a remote client of another computer", () => {
  for (const options of [{ appleSpeech: false }, { remote: true }]) {
    const h = harness(options);
    h.start();
    assert.equal(h.handle("talk-shortcut:state", {}).available, false);
    assert.deepEqual(talkKeys(h), []);
  }
  const h = harness();
  h.start();
  assert.equal(h.handle("talk-shortcut:state", {}).available, true);
  assert.deepEqual(talkKeys(h), ["Control+Alt+Space"]);
});

for (const [prefix, setting] of Object.entries(SETTINGS)) {
  test(`before ${prefix} is set up its setting says unavailable; afterwards a change passes on only what it understands`, () => {
    const h = harness();
    assert.equal(h.handle(`${prefix}:state`, {}), setting.unavailable);
    assert.equal(h.handle(`${prefix}:set`, {}, { enabled: false }), setting.unavailable);
    h.start();
    const shown = state => ({ enabled: state.enabled, key: state.key, taken: state.taken });
    assert.deepEqual(shown(h.handle(`${prefix}:set`, {}, { enabled: "no", key: 7, extra: 1 })), { enabled: true, key: setting.key, taken: false });
    assert.deepEqual(shown(h.handle(`${prefix}:set`, {}, { enabled: false })), { enabled: false, key: setting.key, taken: false });
    assert.deepEqual(setting.keys(h), []);
    h.handle(`${prefix}:set`, {}, { enabled: true, key: setting.other });
    assert.deepEqual(setting.keys(h), [setting.accelerator]);
    h.talk.close();
    assert.deepEqual([...h.registered.keys()], [], "quitting lets the key go");
  });
}

test("a press listens until the key's modifiers are let go, and asks this computer's own server; in development, the dev server's proxy", () => {
  const built = harness();
  built.start();
  built.press();
  assert.equal(typeof built.started[0][0].transcript, "function", "the box's own speech sink, not a window");
  assert.deepEqual(built.started.map(([, options]) => options), [{ finishOnRelease: ["control", "option"] }]);
  assert.deepEqual(built.requests, [["local", "/api/bots?messages=0"]]);
  built.talk.close();

  const dev = harness({ packaged: false });
  dev.start();
  dev.press();
  assert.deepEqual(dev.requests, [["dev", "http://127.0.0.1:5199/api/bots?messages=0"]]);
  dev.talk.close();
});

test("a call or composer dictation holding the microphone keeps a press from listening", () => {
  const h = harness();
  h.start();
  const page = new EventEmitter();
  h.handle("call:active", { sender: page }, true);
  h.press();
  assert.equal(h.started.length, 0);
  h.handle("call:active", { sender: page }, "yes");
  h.press();
  assert.equal(h.started.length, 1);
  h.talk.close();

  const dictating = harness();
  dictating.busy = true;
  dictating.start();
  dictating.press();
  assert.equal(dictating.started.length, 0);
  dictating.talk.close();
});

test("a talk shortcut that cannot be set up is logged, says unavailable, and startup goes on", () => {
  const h = harness({ register: () => { throw new Error("no hotkeys"); } });
  assert.doesNotThrow(() => h.start());
  assert.deepEqual(h.log, ["talk shortcut unavailable: no hotkeys"]);
  assert.equal(h.handle("talk-shortcut:state", {}), TALK_SHORTCUT_UNAVAILABLE);
  assert.doesNotThrow(() => h.talk.close());
});

test("a press, an open or a dismiss that throws is logged, never thrown at Electron", () => {
  const h = harness();
  h.start();
  h.fail.busy = "busy broke";
  h.press();
  h.fail.busy = null;
  h.press();
  h.fail.reveal = "reveal broke";
  h.click("open");
  h.fail.reveal = null;
  h.press();
  h.fail.stop = "stop broke";
  h.click("dismiss");
  h.fail.stop = null;
  assert.deepEqual(h.log, ["talk press failed: busy broke", "talk open failed: reveal broke", "talk dismiss failed: stop broke"]);
  h.talk.close();
});

test("clicking the box opens its chat by a link with both ids escaped, or else just shows MausBot", async () => {
  const h = harness({ serve: route => {
    if (route === "/api/bots?messages=0") return json({ bots: [{ id: "b?1&x", defaultBot: {}, tasks: [] }] });
    if (route === "/api/bots/b%3F1%26x/tasks") return json({ task: { threadId: "t 1/x" } });
    return undefined;
  } });
  h.start();
  h.press();
  h.click("open");
  assert.equal(h.reveals, 1);
  assert.deepEqual(h.links, []);
  h.press();
  await settle();
  const [sink] = h.started.at(-1);
  sink.transcript({ text: "what's on today" });
  sink.end({ code: 0, reason: "completed" });
  h.click("open");
  assert.deepEqual(h.links, ["openmausbot://thread/t%201%2Fx?bot=b%3F1%26x"]);
  h.talk.close();
});

test("while home needs a sign-in the shortcut is unavailable and the key free; home on My Cloud or here again takes it back", () => {
  const h = harness();
  h.home = { kind: "signin" };
  h.start();
  assert.equal(h.handle("talk-shortcut:state", {}).available, false);
  assert.deepEqual([...h.registered.keys()], []);
  assert.equal(h.handle("talk-shortcut:set", {}, { enabled: false }).available, false, "a change does nothing meanwhile");
  h.home = HOME_CLOUD;
  h.talk.homeChanged();
  assert.equal(h.handle("talk-shortcut:state", {}).available, true);
  assert.deepEqual(talkKeys(h), ["Control+Alt+Space"]);
  h.home = HOME_HERE;
  h.talk.homeChanged();
  assert.deepEqual(talkKeys(h), ["Control+Alt+Space"], "kept from My Cloud to this computer");
  h.home = { kind: "signin", other: true };
  h.talk.homeChanged();
  assert.deepEqual([...h.registered.keys()], []);
  h.fail.home = "home unknown";
  assert.doesNotThrow(() => h.talk.homeChanged());
  assert.deepEqual(h.log, ["talk home change failed: home unknown", "talk home change failed: home unknown"], "each key is refreshed on its own");
  const early = harness();
  assert.doesNotThrow(() => early.talk.homeChanged(), "before start");
  h.talk.close();

  const bare = harness({ myCloud: false });
  bare.home = HOME_CLOUD;
  bare.start();
  assert.equal(bare.handle("talk-shortcut:state", {}).available, false, "no way to reach My Cloud, no shortcut there");
  bare.talk.close();
});

test("a press while home is My Cloud asks MausBot there over the window's own session, never this computer's server", async () => {
  const h = harness({ serve: (route, where) => {
    if (where !== "cloud") return undefined;
    if (route === "/api/bots?messages=0") return json({ bots: [{ id: "b?1&x", defaultBot: {}, tasks: [] }] });
    if (route === "/api/bots/b%3F1%26x/tasks") return Promise.resolve(Response.json({ task: { threadId: "t 1/x" } }, { status: 201 }));
    return undefined;
  } });
  h.home = HOME_CLOUD;
  h.start();
  h.press();
  await settle();
  assert.deepEqual(h.where(), [["cloud", `${CLOUD}/api/bots?messages=0`], ["cloud", `${CLOUD}/api/bots/b%3F1%26x/tasks`]]);
  const [, , init] = h.requests[0];
  assert.equal(init.credentials, "include");
  assert.equal(init.headers.origin, CLOUD);
  const [sink] = h.started.at(-1);
  sink.transcript({ text: "what's on today" });
  sink.end({ code: 0, reason: "completed" });
  await settle();
  assert.deepEqual(h.where().at(-1), ["cloud", `${CLOUD}/api/events?screens=off`]);
  h.click("open");
  assert.deepEqual(h.links, ["openmausbot://thread/t%201%2Fx?bot=b%3F1%26x"], "the chat on My Cloud's page, ids escaped as before");
  assert.equal(h.requests.some(([where]) => where === "local"), false);
  h.talk.close();
});

test("home's origin that is not the verified My Cloud asks nothing and says it couldn't reach My Cloud", async () => {
  const h = harness();
  h.home = HOME_CLOUD;
  h.mine = "https://other.example.test";
  h.start();
  h.press();
  await settle();
  assert.deepEqual(h.requests, []);
  assert.deepEqual((await h.painted()).at(-1), { state: "error", text: "Couldn't reach My Cloud. Try again in a moment." });
  h.talk.close();
});

test("a press while My Cloud sleeps wakes it through the Admin, and the box says so once the words are let go", async () => {
  const h = harness({ serve: (route, where) => (where === "cloud" && route === "/api/auth/session" ? json({ kind: "session" }) : undefined) });
  h.home = HOME_CLOUD;
  h.cloudPower = { state: "asleep", since: 1, sleeps: true };
  h.start();
  h.press();
  const [sink] = h.started.at(-1);
  sink.transcript({ text: "hello" });
  sink.end({ code: 0, reason: "completed" });
  assert.deepEqual((await h.painted()).at(-1), { state: "waking", text: "hello" });
  assert.equal(h.wakes, 1);
  assert.deepEqual(h.where(), [["cloud", `${CLOUD}/api/auth/session`], ["cloud", `${CLOUD}/api/bots?messages=0`]]);
  assert.equal(h.talk.busy(), true);
  h.talk.close();
});

test("an ask stays with the server that found its chat when home changes before it is sent", async () => {
  const serve = (route, where) => {
    if (route === "/api/bots?messages=0") return json({ bots: [{ id: "m", defaultBot: {}, tasks: [] }] });
    if (route === "/api/bots/m/tasks") return Promise.resolve(Response.json({ task: { threadId: `t-${where}` } }, { status: 201 }));
    return undefined;
  };
  const send = async h => {
    const [sink] = h.started.at(-1);
    sink.transcript({ text: "hello" });
    sink.end({ code: 0, reason: "completed" });
    await settle();
  };
  const here = harness({ serve });
  here.start();
  here.press();
  await settle();
  here.home = HOME_CLOUD;
  await send(here);
  assert.deepEqual(here.where().at(-1), ["local", "/api/events?screens=off"]);
  assert.equal(here.requests.some(([where]) => where === "cloud"), false, "this computer's chat never goes to My Cloud");
  here.talk.close();

  const there = harness({ serve });
  there.home = HOME_CLOUD;
  there.start();
  there.press();
  await settle();
  there.home = HOME_HERE;
  await send(there);
  assert.equal(there.requests.some(([where]) => where === "local"), false, "My Cloud's chat never goes to this computer");
  assert.deepEqual((await there.painted()).at(-1), { state: "error", text: "Couldn't reach My Cloud. Try again in a moment." });
  there.talk.close();
});

test("a press while this computer's server is still starting says so", async () => {
  const h = harness({ serve: route => (route === "/api/bots?messages=0" ? Promise.reject(new Error("not running")) : undefined) });
  h.starting = true;
  h.start();
  h.press();
  await settle();
  assert.deepEqual((await h.painted()).at(-1), { state: "error", text: "MausBot is still starting. Try again in a moment." });
  h.talk.close();
});

test("the box takes the light or dark of the skin the app painted last, before or after it opens", async () => {
  const h = harness();
  h.talk.skin("meadow");
  h.start();
  h.press();
  assert.deepEqual((await h.painted()).at(-1), { state: "listening", text: "", theme: "light" });
  h.talk.skin("midnight");
  await settle();
  assert.deepEqual((await h.painted()).at(-1), { state: "listening", text: "", theme: "dark" });
  h.talk.skin("no-such-skin");
  h.talk.skin(undefined);
  await settle();
  assert.equal((await h.painted()).at(-1).theme, "dark");
  h.talk.close();
});

test("busy while a talk ask is under way, never before the shortcut is set up", () => {
  const h = harness();
  assert.equal(h.talk.busy(), false);
  h.start();
  assert.equal(h.talk.busy(), false);
  h.press();
  assert.equal(h.talk.busy(), true);
  h.click("dismiss");
  assert.equal(h.talk.busy(), false);
  h.talk.close();
});

test("quitting while listening logs a failure to stop speech and still lets the key go", () => {
  const h = harness();
  h.start();
  h.press();
  h.fail.stop = "stop broke";
  assert.doesNotThrow(() => h.talk.close());
  assert.deepEqual(h.log, ["talk close failed: stop broke"]);
  assert.deepEqual([...h.registered.keys()], []);
});

test("the type shortcut is offered on macOS without Apple speech, never elsewhere or on a remote client", () => {
  const mac = harness({ appleSpeech: false }); mac.start();
  assert.deepEqual([mac.handle("type-shortcut:state", {}).available, mac.handle("talk-shortcut:state", {}).available], [true, false]);
  assert.deepEqual([...mac.registered.keys()], ["Control+Alt+T"]);
  for (const options of [{ platform: "win32", appleSpeech: false }, { remote: true }]) {
    const h = harness(options); h.start();
    assert.deepEqual([h.handle("type-shortcut:state", {}).available, h.registered.has("Control+Alt+T")], [false, false]);
  }
});

test("before it is set up the type setting says unavailable; afterwards each setting moves only its own key", () => {
  const h = harness();
  assert.equal(h.handle("type-shortcut:state", {}), TYPE_SHORTCUT_UNAVAILABLE);
  h.start();
  h.handle("talk-shortcut:set", {}, { enabled: false });
  assert.deepEqual([...h.registered.keys()], ["Control+Alt+T"]);
  h.handle("type-shortcut:set", {}, { key: "opt-shift-t", extra: 1 });
  assert.deepEqual([...h.registered.keys()], ["Alt+Shift+T"]);
  assert.equal(h.handle("talk-shortcut:state", {}).key, "ctrl-opt-space");
  h.talk.close();
  assert.deepEqual([...h.registered.keys()], []);
});

test("⌃⌥T opens the focusable box; Return asks this computer's Quick asks and talk's never-focused box takes over", async () => {
  const h = harness(); h.start(); h.typePress();
  const typing = h.typeBox();
  typing.webContents.emit("did-finish-load"); await settle();
  typing.webContents.emit("ipc-message", {}, "type-box:send", "what's on");
  await settle();
  assert.equal(typing.destroyed, true);
  assert.deepEqual(h.where()[0], ["local", "/api/bots?messages=0"]);
  assert.deepEqual((await h.painted())[0], { state: "sending", text: "", echo: "what's on" });
  assert.equal(h.box().options.focusable, false);
  h.talk.close();
});

test("the type box opens in the skin the app painted last", async () => {
  const h = harness(); h.talk.skin("meadow"); h.start(); h.talk.skin("midnight"); h.typePress();
  h.typeBox().webContents.emit("did-finish-load"); await settle();
  assert.equal(h.typeBox().webContents.scripts[0], 'start({"text":"","theme":"dark"})');
  h.talk.close();
});

test("home needing a sign-in lets ⌃⌥T go; My Cloud as home takes it back", () => {
  const h = harness(); h.start();
  h.home = { kind: "signin" }; h.talk.homeChanged();
  assert.deepEqual([h.registered.has("Control+Alt+T"), h.handle("type-shortcut:state", {}).available], [false, false]);
  h.home = HOME_CLOUD; h.talk.homeChanged();
  assert.equal(h.registered.has("Control+Alt+T"), true);
  h.talk.close();
});

test("quitting closes an open type box and lets both keys go", () => {
  const h = harness(); h.start(); h.typePress();
  const typing = h.typeBox();
  h.talk.close();
  assert.deepEqual([typing.destroyed, [...h.registered.keys()]], [true, []]);
});

test("the type setting reaches My Cloud's own page while it is home, never a team's, and needs a click there to turn on", async () => {
  const h = harness(); h.home = HOME_CLOUD; h.start();
  assert.equal(h.handle("type-shortcut:state", { remote: true, cloudPage: true, senderFrame: { origin: CLOUD } }).available, true);
  assert.throws(() => h.handle("type-shortcut:set", { remote: true, cloudPage: false, senderFrame: { origin: "https://team.example.test" } }, { enabled: false }), /only available/);
  const page = preloadAt(CLOUD, { home: true, talk: true });
  await assert.rejects(page.bridge.typeShortcut.set({ enabled: true }), /type shortcut/);
  await assert.rejects(page.bridge.typeShortcut.set({ key: "ctrl-shift-t" }), /type shortcut/);
  await page.bridge.typeShortcut.set({ enabled: false });
  assert.deepEqual(plain(page.invoked), [["type-shortcut:set", { enabled: false }]]);
  assert.equal(preloadAt("https://team.example.test", { home: true, talk: false }).bridge.typeShortcut, undefined);
  h.talk.close();
});

test("a type shortcut that cannot be set up lets talk's key go too, so no key is left with nothing behind it", () => {
  const h = harness({ register: (accelerator, press) => {
    if (accelerator === "Control+Alt+T") throw new Error("no hotkeys");
    h.registered.set(accelerator, press);
    return true;
  } });
  assert.doesNotThrow(() => h.start());
  assert.deepEqual([h.log, [...h.registered.keys()]], [["talk shortcut unavailable: no hotkeys"], []]);
  assert.deepEqual([h.handle("talk-shortcut:state", {}), h.handle("type-shortcut:state", {})], [TALK_SHORTCUT_UNAVAILABLE, TYPE_SHORTCUT_UNAVAILABLE]);
});
