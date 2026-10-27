import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createDesktopPrefs } from "./desktop-prefs.mjs";
import { createCallPresence, createTalkShortcut } from "./talk-shortcut.mjs";

const memoryPrefs = () => {
  let saved = null;
  return createDesktopPrefs({ read: () => saved, write: value => { saved = structuredClone(value); } });
};
const fakeShortcuts = (taken = []) => {
  const registered = new Map();
  return { registered, register: (accelerator, fn) => !taken.includes(accelerator) && Boolean(registered.set(accelerator, fn)),
    unregister: accelerator => { registered.delete(accelerator); } };
};
const KEYS = [{ id: "ctrl-opt-space", label: "⌃⌥Space" }, { id: "ctrl-shift-space", label: "⌃⇧Space" }, { id: "opt-shift-space", label: "⌥⇧Space" }];

test("registers the saved key when on; a press reaches onPress", () => {
  const shortcuts = fakeShortcuts(); let presses = 0;
  const talk = createTalkShortcut({ globalShortcut: shortcuts, prefs: memoryPrefs(), available: () => true, onPress: () => { presses += 1; } });
  assert.deepEqual([...shortcuts.registered.keys()], ["Control+Alt+Space"]);
  shortcuts.registered.get("Control+Alt+Space")();
  assert.equal(presses, 1);
  assert.deepEqual(talk.state(), { available: true, enabled: true, key: "ctrl-opt-space", keys: KEYS, taken: false });
  assert.deepEqual(talk.releaseModifiers(), ["control", "option"]);
});

test("a key another app holds is reported, and another key can be chosen", () => {
  const shortcuts = fakeShortcuts(["Control+Alt+Space"]); const prefs = memoryPrefs();
  const talk = createTalkShortcut({ globalShortcut: shortcuts, prefs, available: () => true, onPress: () => {} });
  assert.equal(talk.state().taken, true);
  assert.deepEqual(talk.set({ key: "ctrl-shift-space" }), { available: true, enabled: true, key: "ctrl-shift-space", keys: KEYS, taken: false });
  assert.deepEqual([...shortcuts.registered.keys()], ["Control+Shift+Space"]);
  assert.deepEqual(talk.releaseModifiers(), ["control", "shift"]);
  assert.equal(prefs.talkKey(), "ctrl-shift-space");
});

test("off lets the key go, on takes it again, close lets it go", () => {
  const shortcuts = fakeShortcuts(); const prefs = memoryPrefs();
  const talk = createTalkShortcut({ globalShortcut: shortcuts, prefs, available: () => true, onPress: () => {} });
  assert.equal(talk.set({ enabled: false }).enabled, false);
  assert.deepEqual([...shortcuts.registered.keys()], []);
  assert.equal(prefs.talkShortcut(), false);
  assert.equal(talk.state().taken, false);
  talk.set({ enabled: true });
  assert.deepEqual([...shortcuts.registered.keys()], ["Control+Alt+Space"]);
  talk.close();
  assert.deepEqual([...shortcuts.registered.keys()], []);
});

test("an unknown key changes nothing", () => {
  const shortcuts = fakeShortcuts(); const prefs = memoryPrefs();
  const talk = createTalkShortcut({ globalShortcut: shortcuts, prefs, available: () => true, onPress: () => {} });
  talk.set({ key: "cmd-space" });
  assert.deepEqual([...shortcuts.registered.keys()], ["Control+Alt+Space"]);
  assert.equal(prefs.talkKey(), "ctrl-opt-space");
});

test("where Apple speech is unavailable nothing registers and nothing changes", () => {
  const shortcuts = fakeShortcuts(); const prefs = memoryPrefs();
  const talk = createTalkShortcut({ globalShortcut: shortcuts, prefs, available: () => false, onPress: () => {} });
  assert.deepEqual([...shortcuts.registered.keys()], []);
  assert.equal(talk.state().available, false);
  talk.set({ enabled: false, key: "opt-shift-space" });
  assert.equal(prefs.talkShortcut(), true);
  assert.equal(prefs.talkKey(), "ctrl-opt-space");
  assert.deepEqual([...shortcuts.registered.keys()], []);
});

test("a reported call blocks until it ends, its page navigates, or its renderer goes away", () => {
  const presence = createCallPresence(), page = Object.assign(new EventEmitter(), { id: 1 });
  presence.set(page, true); assert.equal(presence.active(), true);
  presence.set(page, false); assert.equal(presence.active(), false);
  for (const event of ["did-navigate", "render-process-gone", "destroyed"]) {
    presence.set(page, true); page.emit(event); assert.equal(presence.active(), false, event);
  }
  for (let i = 0; i < 5; i += 1) presence.set(page, true);
  for (const event of ["did-navigate", "render-process-gone", "destroyed"]) assert.equal(page.listenerCount(event), 1, event);
});
