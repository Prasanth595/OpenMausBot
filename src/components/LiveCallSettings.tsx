import { useState } from "react";
import { Check, Settings } from "lucide-react";

import { LIVE_VOICE_OPTIONS } from "../../shared/live-call";
import { liveDisclosure } from "@/lib/call-mode";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, useStore, type ConfigStatus } from "@/state/store";
import type { LiveSettings } from "../../shared/wire";
import { LiveKeySetup } from "./LiveKeySetup";
import { PopoverMenu, type PopoverMenuItem } from "./popover/PopoverMenu";

const IDLE_CHOICES = [1, 2, 3, 5, 10, 15, 30, 60];
const DEFAULT_LIVE: LiveSettings = { configured: false, voice: "", readTypedReplies: true, idleMinutes: 5 };

type SettingsChange = Partial<Pick<LiveSettings, "voice" | "readTypedReplies" | "idleMinutes">>;

/** One choice of a submenu. Picking one reports in place — the check moves to
 * it, and a save that fails says so in the sheet — so the menu stays open. */
function choice(key: string, title: string, checked: boolean, disabled: boolean, onSelect: () => void): PopoverMenuItem {
  return {
    key,
    title,
    role: "menuitemradio",
    checked,
    active: checked,
    trailing: checked ? <Check size={14} className="shrink-0 text-accent" aria-hidden="true" /> : undefined,
    disabled,
    keepOpen: true,
    onSelect,
  };
}

/** The call settings menu's rows, built apart from the component so a test can
 * read the choices without a browser. */
export function liveCallSettingsItems({
  live,
  saving,
  changingKey,
  error,
  cloudHome,
  onVoice,
  onReadTyped,
  onIdle,
  onChangeKey,
  onRemoveKey,
  onKeySaved,
}: {
  live: LiveSettings;
  saving: boolean;
  changingKey: boolean;
  error: string | null;
  cloudHome: boolean;
  onVoice: (voice: string) => void;
  onReadTyped: (read: boolean) => void;
  onIdle: (minutes: number) => void;
  onChangeKey: () => void;
  onRemoveKey: () => void;
  onKeySaved: () => void;
}): PopoverMenuItem[] {
  const voice = live.voice || "marin";
  // A voice saved by an older build stays pickable rather than silently reset.
  const voices = LIVE_VOICE_OPTIONS.some((option) => option.id === voice)
    ? LIVE_VOICE_OPTIONS
    : [{ id: voice, label: voice }, ...LIVE_VOICE_OPTIONS];
  const minutes = [...new Set([...IDLE_CHOICES, live.idleMinutes])].sort((a, b) => a - b);
  const items: PopoverMenuItem[] = [
    {
      key: "voice",
      title: t("call.live.voice"),
      content: t("call.live.voiceNext"),
      lines: { content: -1 },
      value: voices.find((option) => option.id === voice)?.label,
      submenu: voices.map((option) =>
        choice(`voice-${option.id}`, option.label, option.id === voice, saving, () => onVoice(option.id))),
    },
    {
      key: "read-typed",
      title: t("call.live.readTyped"),
      content: t("call.live.readTypedHint"),
      lines: { content: -1 },
      role: "menuitemradio",
      checked: live.readTypedReplies,
      active: live.readTypedReplies,
      trailing: live.readTypedReplies ? <Check size={14} className="shrink-0 text-accent" aria-hidden="true" /> : undefined,
      disabled: saving,
      keepOpen: true,
      onSelect: () => onReadTyped(!live.readTypedReplies),
    },
    {
      key: "idle",
      title: t("call.live.idle"),
      value: String(live.idleMinutes),
      submenu: minutes.map((count) =>
        choice(`idle-${count}`, String(count), count === live.idleMinutes, saving, () => onIdle(count))),
    },
    {
      key: "key-change",
      heading: t("call.live.key"),
      separatorBefore: true,
      title: t("call.live.keyChange"),
      active: changingKey,
      disabled: saving,
      keepOpen: true,
      onSelect: onChangeKey,
    },
    ...(live.configured
      ? [{
          key: "key-remove",
          title: t("call.live.keyRemove"),
          disabled: saving,
          keepOpen: true,
          overrideClassNames: { row: "text-danger hover:bg-danger/10 disabled:hover:bg-transparent" },
          onSelect: onRemoveKey,
        } satisfies PopoverMenuItem]
      : []),
    ...(changingKey
      ? [{
          key: "key-setup",
          // A band, not a row: the form's fields join the sheet's Tab order.
          header: { title: t("call.live.key"), content: <LiveKeySetup compact onSaved={onKeySaved} /> },
        } satisfies PopoverMenuItem]
      : []),
    {
      key: "disclosure",
      render: (
        <p className="px-3 pb-1 pt-2 text-[11.5px] leading-[1.45] text-ink-tertiary">
          {liveDisclosure({ cloudHome })} {t("call.live.cost")}
        </p>
      ),
    },
    ...(error
      ? [{ key: "error", render: <p role="alert" className="px-3 pb-2 text-[12px] text-danger">{error}</p> } satisfies PopoverMenuItem]
      : []),
  ];
  return items;
}

export function LiveCallSettings({ open, onOpenChange, triggerClassName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bar's own button chrome: the gear is one of its round buttons. */
  triggerClassName: string;
}) {
  const { state, dispatch } = useStore();
  const live: LiveSettings = state.config?.live ?? DEFAULT_LIVE;
  const [saving, setSaving] = useState(false);
  const [changingKey, setChangingKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: SettingsChange) => {
    setSaving(true);
    setError(null);
    try {
      const body = await api<{ live: LiveSettings }>("/api/live/settings", { method: "PATCH", body: JSON.stringify(patch) });
      if (state.config) dispatch({ type: "configStatus", config: { ...state.config, live: body.live } });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    setSaving(true);
    setError(null);
    try {
      const status: ConfigStatus = window.ogb?.setCredential
        ? await window.ogb.setCredential("openaiLiveKey", "")
        : await api("/api/config", { method: "PUT", body: JSON.stringify({ live: { key: "" } }) });
      dispatch({ type: "configStatus", config: status });
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PopoverMenu
      items={liveCallSettingsItems({
        live,
        saving,
        changingKey,
        error,
        cloudHome: state.config?.cloudHome === true,
        onVoice: (voice) => void save({ voice }),
        onReadTyped: (read) => void save({ readTypedReplies: read }),
        onIdle: (idleMinutes) => void save({ idleMinutes }),
        onChangeKey: () => setChangingKey((shown) => !shown),
        onRemoveKey: () => void removeKey(),
        onKeySaved: () => setChangingKey(false),
      })}
      ariaLabel={t("call.live.settings")}
      triggerTitle={t("call.live.settings")}
      placement="above"
      align="end"
      width={300}
      open={open}
      onOpenChange={(next) => {
        // A closed sheet keeps nothing: the key form folds away and an old
        // save error does not meet the person at the next open.
        if (!next) {
          setChangingKey(false);
          setError(null);
        }
        onOpenChange(next);
      }}
      triggerClassName={triggerClassName}
      trigger={({ open: shown }) => <Settings className={cn("size-3.5", shown && "text-ink")} aria-hidden="true" />}
    />
  );
}
