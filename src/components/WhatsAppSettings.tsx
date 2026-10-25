import { useEffect, useState } from "react";
import { Check, Loader2, Send } from "lucide-react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { Card, CommandLine, Switch } from "./SettingsPrimitives";

export interface WhatsAppStatus {
  enabled: boolean;
  accountSid: string;
  hasToken: boolean;
  from: string;
  allowed: string[];
  lastError?: { at: number; message: string };
  webhookUrl: string;
  reachable: boolean;
  available: boolean;
}

const inputCls = "w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none disabled:opacity-50";
const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : t("whatsapp.failed"));

export function WhatsAppSettings() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [from, setFrom] = useState("");
  const [allowed, setAllowed] = useState("");
  const [busy, setBusy] = useState<"loading" | "saving" | "testing" | null>("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adopt = (next: WhatsAppStatus) => {
    setStatus(next);
    setAccountSid(next.accountSid);
    setFrom(next.from.replace(/^whatsapp:/, ""));
    setAllowed(next.allowed.join(", "));
    setAuthToken("");
  };

  useEffect(() => {
    const controller = new AbortController();
    void api("/api/whatsapp", { signal: controller.signal })
      .then((next: WhatsAppStatus) => { if (!controller.signal.aborted) adopt(next); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(null); });
    return () => controller.abort();
  }, []);

  const save = async (enabled = status?.enabled ?? false) => {
    setBusy("saving");
    setError(null);
    setNotice(null);
    try {
      adopt(await api("/api/whatsapp", {
        method: "PUT",
        body: JSON.stringify({
          accountSid: accountSid.trim(),
          ...(authToken.trim() ? { authToken: authToken.trim() } : {}),
          from: from.trim(),
          allowed: allowed.split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
          enabled,
        }),
      }));
      setNotice(t("whatsapp.saved"));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("testing");
    setError(null);
    setNotice(null);
    try {
      adopt(await api("/api/whatsapp/test", { method: "POST" }));
      setNotice(t("whatsapp.testSent"));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title={t("whatsapp.title")} subtitle={t("whatsapp.subtitle")}>
      <div className="space-y-3" data-whatsapp-settings>
        {busy === "loading" && <p role="status" className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={14} className="animate-spin" />{t("whatsapp.loading")}</p>}
        {status && !status.available && <p className="text-[13px] leading-relaxed text-ink-secondary">{t("whatsapp.teamUnavailable")}</p>}
        {status?.available && (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-medium text-ink">{t("whatsapp.enable")}</span>
              <Switch checked={status.enabled} aria-label={t("whatsapp.enable")} disabled={busy !== null} onClick={() => void save(!status.enabled)} />
            </div>
            <form onSubmit={(event) => { event.preventDefault(); if (!busy) void save(); }} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-[12.5px] font-medium text-ink">{t("whatsapp.accountSid")}</span>
                <input value={accountSid} onChange={(event) => setAccountSid(event.target.value)} placeholder="AC…" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={busy !== null} className={inputCls} />
              </label>
              <label className="block space-y-1">
                <span className="text-[12.5px] font-medium text-ink">{t("whatsapp.authToken")}</span>
                <input type="password" value={authToken} onChange={(event) => setAuthToken(event.target.value)} placeholder={status.hasToken ? t("whatsapp.tokenSaved") : ""} autoComplete="off" disabled={busy !== null} className={inputCls} />
              </label>
              <label className="block space-y-1">
                <span className="text-[12.5px] font-medium text-ink">{t("whatsapp.from")}</span>
                <input value={from} onChange={(event) => setFrom(event.target.value)} placeholder="+14155238886" disabled={busy !== null} className={inputCls} />
                <span className="block text-[11.5px] text-ink-secondary">{t("whatsapp.fromHint")}</span>
              </label>
              <label className="block space-y-1">
                <span className="text-[12.5px] font-medium text-ink">{t("whatsapp.allowed")}</span>
                <input value={allowed} onChange={(event) => setAllowed(event.target.value)} placeholder="+14155550100" disabled={busy !== null} className={inputCls} />
                <span className="block text-[11.5px] text-ink-secondary">{t("whatsapp.allowedHint")}</span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy !== null} className="ui-button ui-button-primary">
                  {busy === "saving" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {t("whatsapp.save")}
                </button>
                <button type="button" disabled={busy !== null || !status.hasToken || !status.allowed.length} onClick={() => void test()} className="inline-flex items-center gap-1.5 rounded-lg bg-control px-3 py-2 text-[12px] font-medium text-ink hover:bg-raised-hover disabled:opacity-50">
                  {busy === "testing" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {t("whatsapp.test")}
                </button>
              </div>
            </form>
            <div className="space-y-1.5">
              <p className="text-[12.5px] font-medium text-ink">{t("whatsapp.webhook")}</p>
              <CommandLine command={status.webhookUrl} copyLabel={t("whatsapp.copyWebhook")} />
              <p className="text-[11.5px] leading-relaxed text-ink-secondary">{t("whatsapp.webhookHint")}</p>
              {!status.reachable && <p role="note" className="text-[12px] leading-relaxed text-warning">{t("whatsapp.notReachable")}</p>}
            </div>
            <p className="text-[11.5px] leading-relaxed text-ink-secondary">{t("whatsapp.sandboxHint")}</p>
            <p className="text-[11.5px] leading-relaxed text-ink-secondary">{t("whatsapp.routingHint")}</p>
            {status.lastError && <p role="alert" className="text-[12px] leading-relaxed text-danger">{status.lastError.message}</p>}
          </>
        )}
        {notice && <p role="status" className="flex items-start gap-1.5 text-[12px] leading-relaxed text-success"><Check size={14} className="mt-0.5 shrink-0" />{notice}</p>}
        {error && <p role="alert" className="text-[12px] leading-relaxed text-danger">{error}</p>}
      </div>
    </Card>
  );
}
