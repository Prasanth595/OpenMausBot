import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { Card } from "./SettingsPrimitives";

type Mode = "direct" | "system" | "manual";
type ProxySettings = { mode: Mode; url: string };

export function ProxySettings() {
  const bridge = window.ogb?.desktopProxy;
  const [settings, setSettings] = useState<ProxySettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { if (bridge) void bridge.read().then(setSettings).catch(() => setError(true)); }, [bridge]);
  if (!bridge) return null;
  async function save() {
    if (!settings || !bridge) return;
    try { setSettings(await bridge.save(settings)); setError(false); setSaved(true); }
    catch { setSaved(false); setError(true); }
  }
  return <Card title={t("proxy.title")} subtitle={t("proxy.description")}>
    {settings && <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">{t("proxy.mode")}
        <select className="rounded-md border border-hairline bg-app p-2 text-ink" value={settings.mode} onChange={event => { setSettings({ ...settings, mode: event.target.value as Mode }); setSaved(false); }}>
          <option value="direct">{t("proxy.direct")}</option>
          <option value="system">{t("proxy.system")}</option>
          <option value="manual">{t("proxy.manual")}</option>
        </select>
      </label>
      {settings.mode === "manual" && <label className="flex min-w-48 flex-[2] flex-col gap-1 text-sm">{t("proxy.address")}
        <input className="rounded-md border border-hairline bg-app p-2 text-ink" type="url" placeholder="http://127.0.0.1:7897" value={settings.url} onChange={event => { setSettings({ ...settings, url: event.target.value }); setSaved(false); }} />
      </label>}
      <button type="button" className="shrink-0 rounded-md bg-accent px-3 py-2 text-sm text-white" onClick={() => void save()}>{t("proxy.save")}</button>
      </div>
      {settings.mode === "manual" && <p className="text-xs text-ink-secondary">{t("proxy.addressHint")}</p>}
      {settings.mode === "system" && <p className="text-xs text-ink-secondary">{t("proxy.systemHint")}</p>}
      {saved && <p role="status" className="text-sm text-ink-secondary">{t("proxy.saved")}</p>}
    </div>}
    {error && <p role="alert" className="mt-2 text-sm text-danger">{t("proxy.error")}</p>}
  </Card>;
}
