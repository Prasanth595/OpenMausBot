import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(join(here, "main.mjs"), "utf8");
const preload = readFileSync(join(here, "preload.cjs"), "utf8");

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

test("quitting closes the talk box and frees the shortcut first", () => {
  assert.match(main, /app\.on\("before-quit", \(e\) => \{\s*talkSession\?\.close\(\); talkShortcut\?\.close\(\);/);
});
