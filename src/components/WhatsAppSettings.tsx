import { useEffect, useState, type ReactNode } from "react";
import { Check, ExternalLink, Loader2, MessageCircle, Send } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { cn } from "@/lib/cn";
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { Card, CommandLine, Switch } from "./SettingsPrimitives";

export interface WhatsAppStatus {
  enabled: boolean;
  accountSid: string;
  hasToken: boolean;
  from: string;
  allowed: string[];
  linked: string[];
  lastError?: { at: number; message: string };
  accountName?: string;
  joinPhrase?: string;
  joinUrl?: string;
  linkExpiresAt?: number;
  sandbox: boolean;
  mode: "instant" | "polling";
  webhookUrl: string;
  reachable: boolean;
  available: boolean;
}

const TWILIO_SIGNUP = "https://www.twilio.com/try-twilio";
const TWILIO_KEYS = "https://console.twilio.com/";
const TWILIO_SANDBOX = "https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn";
const inputCls = "w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none disabled:opacity-50";
const secondaryCls = "inline-flex items-center gap-1.5 rounded-lg bg-control px-3 py-2 text-[12px] font-medium text-ink hover:bg-raised-hover disabled:opacity-50";
const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : t("whatsapp.failed"));
const display = (from: string) => from.replace(/^whatsapp:/, "");

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children?: ReactNode }) {
  return (
    <section className={cn("rounded-lg border p-3", active ? "border-accent/50" : "border-hairline/50")} data-whatsapp-step={n}>
      <div className="flex items-center gap-2">
        <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", done ? "bg-success text-white" : "bg-control text-ink")}>
          {done ? <Check size={12} aria-label={t("whatsapp.setup.done")} /> : n}
        </span>
        <h3 className="text-[13px] font-medium text-ink">{title}</h3>
      </div>
      {active && children && <div className="mt-3 space-y-2.5">{children}</div>}
    </section>
  );
}

function ScanToSend({ url, text, to }: { url: string; text: string; to: string }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="rounded-lg bg-white p-2"><QRCodeSVG value={url} size={132} level="M" bgColor="#ffffff" fgColor="#111111" /></div>
      <div className="min-w-0 flex-1 space-y-2 text-[12px] leading-relaxed text-ink-secondary">
        <p>{t("whatsapp.setup.scan")}</p>
        <a href={url} target="_blank" rel="noreferrer" className="ui-button ui-button-primary inline-flex"><MessageCircle size={14} />{t("whatsapp.setup.openWhatsApp")}</a>
        <p>{t("whatsapp.setup.orSend", { text, to })}</p>
      </div>
    </div>
  );
}

export function WhatsAppSettings() {
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [joinPhrase, setJoinPhrase] = useState("");
  const [joined, setJoined] = useState(false);
  const [link, setLink] = useState<{ code: string; linkUrl: string } | null>(null);
  const [from, setFrom] = useState("");
  const [allowed, setAllowed] = useState("");
  const [busy, setBusy] = useState<"loading" | "checking" | "saving" | "linking" | "testing" | null>("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adopt = (next: WhatsAppStatus) => {
    setStatus(next);
    setAccountSid(next.accountSid);
    setJoinPhrase(next.joinPhrase ?? "");
    setFrom(display(next.from));
    setAllowed(next.allowed.join(", "));
    setAuthToken("");
  };

  const run = async (kind: NonNullable<typeof busy>, work: () => Promise<WhatsAppStatus>, done?: string) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      adopt(await work());
      if (done) setNotice(done);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void api("/api/whatsapp", { signal: controller.signal })
      .then((next: WhatsAppStatus) => { if (!controller.signal.aborted) adopt(next); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setBusy(null); });
    return () => controller.abort();
  }, []);

  const waiting = Boolean(link && status?.linkExpiresAt && status.linkExpiresAt > Date.now());
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void api("/api/whatsapp").then((next: WhatsAppStatus) => {
        setStatus(next);
        if (!next.linkExpiresAt) setLink(null);
      }).catch(() => undefined);
    }, 2_000);
    return () => clearInterval(timer);
  }, [waiting]);

  if (!status) {
    return (
      <Card title={t("whatsapp.title")} subtitle={t("whatsapp.subtitle")}>
        {busy === "loading" && <p role="status" className="flex items-center gap-2 text-[13px] text-ink-secondary"><Loader2 size={14} className="animate-spin" />{t("whatsapp.loading")}</p>}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </Card>
    );
  }
  if (!status.available) {
    return <Card title={t("whatsapp.title")} subtitle={t("whatsapp.subtitle")}><p className="text-[13px] text-ink-secondary">{t("whatsapp.teamUnavailable")}</p></Card>;
  }

  const connected = Boolean(status.accountName);
  const linked = status.allowed.length > 0;
  const joinDone = !status.sandbox || joined || linked;
  const sender = display(status.from);
  const verify = () => run("checking", () => api("/api/whatsapp/verify", { method: "POST", body: JSON.stringify({ accountSid: accountSid.trim(), ...(authToken.trim() ? { authToken: authToken.trim() } : {}) }) }));
  const saveJoin = () => run("saving", () => api("/api/whatsapp", { method: "PUT", body: JSON.stringify({ joinPhrase: joinPhrase.trim() }) }));
  const startLink = () => run("linking", async () => {
    const next: WhatsAppStatus & { code: string; linkUrl: string } = await api("/api/whatsapp/link", { method: "POST" });
    setLink({ code: next.code, linkUrl: next.linkUrl });
    return next;
  });
  const saveAdvanced = (enabled = status.enabled) => run("saving", () => api("/api/whatsapp", {
    method: "PUT",
    body: JSON.stringify({ from: from.trim(), allowed: allowed.split(/[,\n]/).map((value) => value.trim()).filter(Boolean), enabled }),
  }), t("whatsapp.saved"));
  const test = () => run("testing", () => api("/api/whatsapp/test", { method: "POST" }), t("whatsapp.testSent"));

  return (
    <Card title={t("whatsapp.title")} subtitle={t("whatsapp.subtitle")}>
      <div className="space-y-3" data-whatsapp-settings>
        {linked && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-inset p-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">{status.enabled ? t("whatsapp.setup.on", { to: sender }) : t("whatsapp.setup.off")}</p>
              <p className="text-[11.5px] text-ink-secondary">{t("whatsapp.setup.linkedTo", { numbers: status.linked.join(", ") })} · {status.mode === "instant" ? t("whatsapp.setup.instant") : t("whatsapp.setup.polling")}</p>
            </div>
            <Switch checked={status.enabled} aria-label={t("whatsapp.enable")} disabled={busy !== null} onClick={() => void saveAdvanced(!status.enabled)} />
          </div>
        )}

        <Step n={1} title={connected ? t("whatsapp.setup.connected", { name: status.accountName! }) : t("whatsapp.setup.connect")} done={connected} active={!connected}>
          <p className="text-[12px] leading-relaxed text-ink-secondary">
            {t("whatsapp.setup.connectHint")}{" "}
            <a href={TWILIO_SIGNUP} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">{t("whatsapp.setup.signup")}<ExternalLink size={11} /></a>{" · "}
            <a href={TWILIO_KEYS} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">{t("whatsapp.setup.whereKeys")}<ExternalLink size={11} /></a>
          </p>
          <form onSubmit={(event) => { event.preventDefault(); if (!busy) void verify(); }} className="space-y-2">
            <label className="block space-y-1">
              <span className="text-[12.5px] font-medium text-ink">{t("whatsapp.accountSid")}</span>
              <input value={accountSid} onChange={(event) => setAccountSid(event.target.value)} placeholder="AC…" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={busy !== null} className={inputCls} />
            </label>
            <label className="block space-y-1">
              <span className="text-[12.5px] font-medium text-ink">{t("whatsapp.authToken")}</span>
              <input type="password" value={authToken} onChange={(event) => setAuthToken(event.target.value)} placeholder={status.hasToken ? t("whatsapp.tokenSaved") : ""} autoComplete="off" disabled={busy !== null} className={inputCls} />
            </label>
            <button type="submit" disabled={busy !== null || !accountSid.trim() || (!authToken.trim() && !status.hasToken)} className="ui-button ui-button-primary">
              {busy === "checking" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{t("whatsapp.setup.check")}
            </button>
          </form>
        </Step>

        {status.sandbox && (
          <Step n={2} title={t("whatsapp.setup.join")} done={connected && joinDone} active={connected && !joinDone}>
            <p className="text-[12px] leading-relaxed text-ink-secondary">
              {t("whatsapp.setup.joinHint")}{" "}
              <a href={TWILIO_SANDBOX} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">{t("whatsapp.setup.openSandbox")}<ExternalLink size={11} /></a>
            </p>
            <form onSubmit={(event) => { event.preventDefault(); if (!busy && joinPhrase.trim()) void saveJoin(); }} className="flex gap-2">
              <input value={joinPhrase} onChange={(event) => setJoinPhrase(event.target.value)} placeholder="join brave-tiger" aria-label={t("whatsapp.setup.joinPhrase")} autoCapitalize="none" spellCheck={false} disabled={busy !== null} className={inputCls} />
              <button type="submit" disabled={busy !== null || !joinPhrase.trim()} className={secondaryCls}>{t("whatsapp.save")}</button>
            </form>
            {status.joinUrl && (
              <>
                <ScanToSend url={status.joinUrl} text={status.joinPhrase!} to={sender} />
                <button type="button" onClick={() => setJoined(true)} className={secondaryCls}><Check size={14} />{t("whatsapp.setup.joined")}</button>
              </>
            )}
          </Step>
        )}

        <Step n={status.sandbox ? 3 : 2} title={t("whatsapp.setup.link")} done={linked && !link} active={connected && joinDone && (!linked || Boolean(link))}>
          {!link && <button type="button" disabled={busy !== null} onClick={() => void startLink()} className="ui-button ui-button-primary">{busy === "linking" ? <Loader2 size={14} className="animate-spin" /> : <MessageCircle size={14} />}{t("whatsapp.setup.linkButton")}</button>}
          {link && waiting && (
            <>
              <ScanToSend url={link.linkUrl} text={`link ${link.code}`} to={sender} />
              <p role="status" className="flex items-center gap-2 text-[12px] text-ink-secondary"><Loader2 size={13} className="animate-spin" />{t("whatsapp.setup.waiting")}</p>
            </>
          )}
          {link && !waiting && <button type="button" onClick={() => setLink(null)} className={secondaryCls}>{linked ? t("whatsapp.setup.linkAnother") : t("whatsapp.setup.expired")}</button>}
        </Step>

        <p className="text-[11.5px] leading-relaxed text-ink-secondary">{t("whatsapp.routingHint")}</p>
        {status.lastError && <p role="alert" className="text-[12px] leading-relaxed text-danger">{status.lastError.message}</p>}
        {notice && <p role="status" className="flex items-start gap-1.5 text-[12px] leading-relaxed text-success"><Check size={14} className="mt-0.5 shrink-0" />{notice}</p>}
        {error && <p role="alert" className="text-[12px] leading-relaxed text-danger">{error}</p>}

        <details className="rounded-lg border border-hairline/50 p-3">
          <summary className="cursor-pointer text-[12.5px] font-medium text-ink">{t("whatsapp.setup.advanced")}</summary>
          <form onSubmit={(event) => { event.preventDefault(); if (!busy) void saveAdvanced(); }} className="mt-3 space-y-3">
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
              <button type="submit" disabled={busy !== null} className={secondaryCls}><Check size={14} />{t("whatsapp.save")}</button>
              <button type="button" disabled={busy !== null || !status.hasToken || !linked} onClick={() => void test()} className={secondaryCls}>
                {busy === "testing" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}{t("whatsapp.test")}
              </button>
            </div>
          </form>
          <div className="mt-3 space-y-1.5">
            <p className="text-[12.5px] font-medium text-ink">{t("whatsapp.webhook")}</p>
            <CommandLine command={status.webhookUrl} copyLabel={t("whatsapp.copyWebhook")} />
            <p className="text-[11.5px] leading-relaxed text-ink-secondary">{status.reachable ? t("whatsapp.webhookHint") : t("whatsapp.setup.webhookOptional")}</p>
          </div>
        </details>
      </div>
    </Card>
  );
}
