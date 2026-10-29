export const TALK_KEYS = Object.freeze({
  "ctrl-opt-space": Object.freeze({ accelerator: "Control+Alt+Space", release: Object.freeze(["control", "option"]), label: "⌃⌥Space" }),
  "ctrl-shift-space": Object.freeze({ accelerator: "Control+Shift+Space", release: Object.freeze(["control", "shift"]), label: "⌃⇧Space" }),
  "opt-shift-space": Object.freeze({ accelerator: "Alt+Shift+Space", release: Object.freeze(["option", "shift"]), label: "⌥⇧Space" }),
});
export const DEFAULT_TALK_KEY = "ctrl-opt-space";
export const isTalkKey = id => typeof id === "string" && Object.hasOwn(TALK_KEYS, id);
export const talkKey = id => TALK_KEYS[isTalkKey(id) ? id : DEFAULT_TALK_KEY];

export const TYPE_KEYS = Object.freeze({
  "ctrl-opt-t": Object.freeze({ accelerator: "Control+Alt+T", label: "⌃⌥T" }),
  "ctrl-shift-t": Object.freeze({ accelerator: "Control+Shift+T", label: "⌃⇧T" }),
  "opt-shift-t": Object.freeze({ accelerator: "Alt+Shift+T", label: "⌥⇧T" }),
});
export const DEFAULT_TYPE_KEY = "ctrl-opt-t";
export const isTypeKey = id => typeof id === "string" && Object.hasOwn(TYPE_KEYS, id);
