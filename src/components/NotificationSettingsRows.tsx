import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import {
  setFinishedNotifications,
  setInputNotifications,
  setNotificationFeed,
  setNotificationSounds,
  useFinishedNotifications,
  useInputNotifications,
  useNotificationFeed,
  useNotificationSounds,
} from "@/lib/notification-preferences";
import { requestNotificationPermission } from "@/lib/notify";
import { SettingRow, Switch } from "./SettingsPrimitives";

export function NotificationRows() {
  return (
    <>
      <DeviceNotificationsRow />
      <NotificationSoundsRow />
      <NotificationFeedRow />
    </>
  );
}

const currentPermission = (): NotificationPermission => (typeof Notification !== "undefined" ? Notification.permission : "default");

/** A browser shows nothing until it is asked from a click; the person may also change the site permission elsewhere. */
export function DeviceNotificationsRow() {
  const [permission, setPermission] = useState(currentPermission);
  const finishedEnabled = useFinishedNotifications();
  const inputEnabled = useInputNotifications();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setPermission(currentPermission());
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  if (typeof Notification === "undefined") return null;

  const blocked = permission === "denied";
  const toggle = async (enabled: boolean, setEnabled: (enabled: boolean) => void) => {
    if (permission === "granted") return setEnabled(!enabled);
    const next = await requestNotificationPermission();
    if (!next) return;
    setPermission(next);
    if (next === "granted") setEnabled(true);
  };

  return (
    <>
      <SettingRow
        title={t("settings.inputNotifications.title")}
        subtitle={t(blocked ? "settings.deviceNotifications.blocked" : "settings.inputNotifications.subtitle")}
      >
        <Switch
          checked={permission === "granted" && inputEnabled}
          disabled={blocked}
          aria-label={t("settings.inputNotifications.title")}
          onClick={() => void toggle(inputEnabled, setInputNotifications)}
        />
      </SettingRow>
      <SettingRow
        title={t("settings.finishedNotifications.title")}
        subtitle={t(blocked ? "settings.deviceNotifications.blocked" : "settings.finishedNotifications.subtitle")}
      >
        <Switch
          checked={permission === "granted" && finishedEnabled}
          disabled={blocked}
          aria-label={t("settings.finishedNotifications.title")}
          onClick={() => void toggle(finishedEnabled, setFinishedNotifications)}
        />
      </SettingRow>
    </>
  );
}

export function NotificationSoundsRow() {
  const enabled = useNotificationSounds();
  return (
    <SettingRow title={t("settings.notificationSounds.title")} subtitle={t("settings.notificationSounds.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.notificationSounds.play")}
        onClick={() => setNotificationSounds(!enabled)}
      />
    </SettingRow>
  );
}

export function NotificationFeedRow() {
  const enabled = useNotificationFeed();
  return (
    <SettingRow title={t("settings.notificationFeed.title")} subtitle={t("settings.notificationFeed.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.notificationFeed.show")}
        onClick={() => setNotificationFeed(!enabled)}
      />
    </SettingRow>
  );
}
