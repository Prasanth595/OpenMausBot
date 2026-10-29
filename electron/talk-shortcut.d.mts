import type { DesktopPrefs } from "./desktop-prefs.mjs";

export type TalkKeyId = "ctrl-opt-space" | "ctrl-shift-space" | "opt-shift-space";
export type TypeKeyId = "ctrl-opt-t" | "ctrl-shift-t" | "opt-shift-t";
export interface ShortcutState<K extends string> {
  /** False hides the setting and lets the key go: not macOS (talk also needs Apple speech), this desktop is a remote
   * client, or home is neither this computer nor My Cloud (this computer's copy is frozen and its home needs a sign-in). */
  available: boolean;
  enabled: boolean;
  key: K;
  keys: { id: K; label: string }[];
  /** On, but another app holds the key. */
  taken: boolean;
}
export interface TalkShortcutState extends ShortcutState<TalkKeyId> {}
export interface TypeShortcutState extends ShortcutState<TypeKeyId> {}
export interface TalkShortcutChange { enabled?: boolean; key?: TalkKeyId }
export interface TypeShortcutChange { enabled?: boolean; key?: TypeKeyId }
/** What the setting says before the shortcut is set up, or when setting it up failed. */
export declare const TALK_SHORTCUT_UNAVAILABLE: Readonly<TalkShortcutState>;
export declare const TYPE_SHORTCUT_UNAVAILABLE: Readonly<TypeShortcutState>;
export interface TalkShortcutBridge {
  state(): Promise<TalkShortcutState>;
  set(change: TalkShortcutChange): Promise<TalkShortcutState>;
}
export interface TypeShortcutBridge {
  state(): Promise<TypeShortcutState>;
  set(change: TypeShortcutChange): Promise<TypeShortcutState>;
}
type GlobalShortcuts = { register(accelerator: string, handler: () => void): boolean; unregister(accelerator: string): void };
export declare function createTalkShortcut(options: {
  globalShortcut: GlobalShortcuts;
  prefs: Pick<DesktopPrefs, "talkShortcut" | "setTalkShortcut" | "talkKey" | "setTalkKey">;
  available(): boolean;
  onPress(): void;
}): {
  state(): TalkShortcutState;
  set(change: { enabled?: unknown; key?: unknown }): TalkShortcutState;
  /** Takes or lets go of the key when `available()` changed since the key was last set up. */
  refresh(): void;
  releaseModifiers(): string[];
  close(): void;
};
export declare function createTypeShortcut(options: {
  globalShortcut: GlobalShortcuts;
  prefs: Pick<DesktopPrefs, "typeShortcut" | "setTypeShortcut" | "typeKey" | "setTypeKey">;
  available(): boolean;
  onPress(): void;
  /** Whether a press can come now (on, available and the key not taken), each time the key is set up. */
  onUsable?(usable: boolean): void;
}): {
  state(): TypeShortcutState;
  set(change: { enabled?: unknown; key?: unknown }): TypeShortcutState;
  /** Takes or lets go of the key when `available()` changed since the key was last set up. */
  refresh(): void;
  close(): void;
};
type Sender = { on(event: string, listener: () => void): unknown; removeListener(event: string, listener: () => void): unknown };
export declare function createCallPresence(): { set(sender: Sender, active: boolean): void; active(): boolean };
