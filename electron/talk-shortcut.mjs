import { DEFAULT_TALK_KEY, DEFAULT_TYPE_KEY, TALK_KEYS, TYPE_KEYS } from "./talk-keys.mjs";

const keyList = keys => Object.entries(keys).map(([id, { label }]) => ({ id, label }));
const TALK_KEY_LIST = keyList(TALK_KEYS), TYPE_KEY_LIST = keyList(TYPE_KEYS);

export const TALK_SHORTCUT_UNAVAILABLE = Object.freeze({ available: false, enabled: false, key: DEFAULT_TALK_KEY, keys: TALK_KEY_LIST, taken: false });
export const TYPE_SHORTCUT_UNAVAILABLE = Object.freeze({ available: false, enabled: false, key: DEFAULT_TYPE_KEY, keys: TYPE_KEY_LIST, taken: false });

function createKeyShortcut({ globalShortcut, keys, keyList: list, enabled, setEnabled, key, setKey, available, onPress }) {
  let registered = null, taken = false, offered = false;
  const release = () => {
    if (registered) globalShortcut.unregister(registered);
    registered = null;
    taken = false;
  };
  const apply = () => {
    release();
    offered = available();
    if (!offered || !enabled()) return;
    const { accelerator } = keys[key()];
    if (globalShortcut.register(accelerator, onPress)) registered = accelerator;
    else taken = true;
  };
  apply();
  const state = () => ({ available: available(), enabled: enabled(), key: key(), keys: list, taken });
  return {
    state,
    set(change) {
      if (!available()) return state();
      if (typeof change?.enabled === "boolean") setEnabled(change.enabled);
      if (change?.key !== undefined) setKey(change.key);
      apply();
      return state();
    },
    refresh() {
      if (available() !== offered) apply();
    },
    close: release,
  };
}

export function createTalkShortcut({ globalShortcut, prefs, available, onPress }) {
  return {
    ...createKeyShortcut({ globalShortcut, keys: TALK_KEYS, keyList: TALK_KEY_LIST, enabled: () => prefs.talkShortcut(),
      setEnabled: value => prefs.setTalkShortcut(value), key: () => prefs.talkKey(), setKey: value => prefs.setTalkKey(value), available, onPress }),
    releaseModifiers: () => [...TALK_KEYS[prefs.talkKey()].release],
  };
}

export function createTypeShortcut({ globalShortcut, prefs, available, onPress }) {
  return createKeyShortcut({ globalShortcut, keys: TYPE_KEYS, keyList: TYPE_KEY_LIST, enabled: () => prefs.typeShortcut(),
    setEnabled: value => prefs.setTypeShortcut(value), key: () => prefs.typeKey(), setKey: value => prefs.setTypeKey(value), available, onPress });
}

const GONE = ["destroyed", "render-process-gone", "did-navigate"];

export function createCallPresence() {
  const calling = new Map();
  const forget = sender => {
    const stop = calling.get(sender);
    if (!stop) return;
    calling.delete(sender);
    stop();
  };
  return {
    set(sender, active) {
      if (!active) return forget(sender);
      if (calling.has(sender)) return;
      const gone = () => forget(sender);
      for (const event of GONE) sender.on(event, gone);
      calling.set(sender, () => { for (const event of GONE) sender.removeListener(event, gone); });
    },
    active: () => calling.size > 0,
  };
}
