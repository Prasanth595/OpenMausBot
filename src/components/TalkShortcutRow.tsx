import { useEffect, useState } from "react";
import type { TalkKeyId, TalkShortcutState } from "../../electron/talk-shortcut.mjs";
import { t } from "@/lib/i18n";
import { Select } from "./Select";
import { SettingRow, Switch } from "./SettingsPrimitives";

export function TalkShortcutRow() {
  const bridge = window.ogb?.talkShortcut;
  const [state, setState] = useState<TalkShortcutState | null>(null);
  useEffect(() => {
    let live = true;
    void bridge?.state().then((next) => { if (live) setState(next); });
    return () => { live = false; };
  }, [bridge]);
  if (!bridge || !state?.available) return null;
  const label = state.keys.find((key) => key.id === state.key)?.label ?? "";
  const change = (next: { enabled?: boolean; key?: TalkKeyId }) => void bridge.set(next).then(setState);
  const message = state.enabled ? (
    <>
      <Select size="sm" className="w-full max-w-[240px]"
        value={state.key}
        aria-label={t("settings.talk.keyAria")}
        // SAFETY: the options are rendered from state.keys, so the value is always a member.
        onChange={(event) => change({ key: event.target.value as TalkKeyId })}
      >
        {state.keys.map((key) => <option key={key.id} value={key.id}>{key.label}</option>)}
      </Select>
      {state.taken && <div role="alert" className="mt-2 text-danger">{t("settings.talk.taken", { key: label })}</div>}
    </>
  ) : null;
  return (
    <SettingRow title={t("settings.talk.title")} subtitle={t("settings.talk.subtitle", { key: label })} message={message}>
      <Switch checked={state.enabled} aria-label={t("settings.talk.aria")} onClick={() => change({ enabled: !state.enabled })} />
    </SettingRow>
  );
}
