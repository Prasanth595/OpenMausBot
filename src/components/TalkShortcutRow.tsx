import { useEffect, useState } from "react";
import type { ShortcutState } from "../../electron/talk-shortcut.mjs";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { Select } from "./Select";
import { SettingRow, Switch } from "./SettingsPrimitives";

/** Settings search finds the talk shortcut only where its row can show: this Mac app's own page, or My Cloud's own page
 * while it is home (the only server page main gives the talk bridge). */
export function talkShortcutKeywords(ogb: Window["ogb"] = typeof window === "undefined" ? undefined : window.ogb): string[] {
  return ogb?.platform === "darwin" && ogb.talkShortcut ? ["talk", "voice", "shortcut", "hotkey", "hold to talk", "push to talk", "quick asks"] : [];
}

export function typeShortcutKeywords(ogb: Window["ogb"] = typeof window === "undefined" ? undefined : window.ogb): string[] {
  return ogb?.platform === "darwin" && ogb.typeShortcut ? ["type", "typing", "keyboard", "shortcut", "hotkey", "quick asks"] : [];
}

interface ShortcutBridge<K extends string> {
  state(): Promise<ShortcutState<K>>;
  set(change: { enabled?: boolean; key?: K }): Promise<ShortcutState<K>>;
}

function ShortcutRow<K extends string>({ bridge, title, subtitle, aria, keyAria }: {
  bridge: ShortcutBridge<K> | undefined;
  title: LocaleKey;
  subtitle: LocaleKey;
  aria: LocaleKey;
  keyAria: LocaleKey;
}) {
  const [state, setState] = useState<ShortcutState<K> | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void bridge?.state().then((next) => { if (live) setState(next); }).catch(() => {});
    return () => { live = false; };
  }, [bridge]);
  if (!bridge || !state?.available) return null;
  const label = state.keys.find((key) => key.id === state.key)?.label ?? "";
  const change = (next: { enabled?: boolean; key?: K }) => {
    setBusy(true); setFailed(false);
    void bridge.set(next).then(setState, () => setFailed(true)).finally(() => setBusy(false));
  };
  const problem = failed ? t("settings.talk.failed") : state.enabled && state.taken ? t("settings.talk.taken", { key: label }) : null;
  const message = (
    <>
      {state.enabled && (
        <Select size="sm" className="w-full max-w-[240px]"
          value={state.key}
          disabled={busy}
          aria-label={t(keyAria)}
          // SAFETY: the options are rendered from state.keys, so the value is always a member.
          onChange={(event) => change({ key: event.target.value as K })}
        >
          {state.keys.map((key) => <option key={key.id} value={key.id}>{key.label}</option>)}
        </Select>
      )}
      {problem && <div role="alert" className={state.enabled ? "mt-2 text-danger" : "text-danger"}>{problem}</div>}
    </>
  );
  return (
    <SettingRow title={t(title)} subtitle={t(subtitle, { key: label })} message={state.enabled || problem ? message : null}>
      <Switch checked={state.enabled} disabled={busy} aria-label={t(aria)} onClick={() => change({ enabled: !state.enabled })} />
    </SettingRow>
  );
}

export function TalkShortcutRow() {
  return <ShortcutRow bridge={window.ogb?.talkShortcut} title="settings.talk.title" subtitle="settings.talk.subtitle" aria="settings.talk.aria" keyAria="settings.talk.keyAria" />;
}

export function TypeShortcutRow() {
  return <ShortcutRow bridge={window.ogb?.typeShortcut} title="settings.type.title" subtitle="settings.type.subtitle" aria="settings.type.aria" keyAria="settings.type.keyAria" />;
}
