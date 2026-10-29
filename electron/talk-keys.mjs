export const TALK_KEYS = Object.freeze({
  "ctrl-opt-space": Object.freeze({ accelerator: "Control+Alt+Space", release: Object.freeze(["control", "option"]), label: "⌃⌥Space" }),
  "ctrl-shift-space": Object.freeze({ accelerator: "Control+Shift+Space", release: Object.freeze(["control", "shift"]), label: "⌃⇧Space" }),
  "opt-shift-space": Object.freeze({ accelerator: "Alt+Shift+Space", release: Object.freeze(["option", "shift"]), label: "⌥⇧Space" }),
});
export const DEFAULT_TALK_KEY = "ctrl-opt-space";
export const isTalkKey = id => typeof id === "string" && Object.hasOwn(TALK_KEYS, id);
export const talkKey = id => TALK_KEYS[isTalkKey(id) ? id : DEFAULT_TALK_KEY];

export const TYPE_KEYS = Object.freeze({
  "ctrl-opt-m": Object.freeze({ accelerator: "Control+Alt+M", label: "⌃⌥M" }),
  "ctrl-shift-m": Object.freeze({ accelerator: "Control+Shift+M", label: "⌃⇧M" }),
  "opt-shift-m": Object.freeze({ accelerator: "Alt+Shift+M", label: "⌥⇧M" }),
});
export const DEFAULT_TYPE_KEY = "ctrl-opt-m";
export const isTypeKey = id => typeof id === "string" && Object.hasOwn(TYPE_KEYS, id);
