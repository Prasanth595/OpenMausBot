import { useState } from "react";
import { ExternalLink, Loader2, Phone, Search } from "lucide-react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";

export interface OwnNumber {
  sid: string;
  phoneNumber: string;
  country: string;
  kind: "local" | "toll-free";
  price?: { amount: string; currency: string };
}

interface Found {
  numbers: Array<{ phoneNumber: string; friendlyName: string; locality?: string; region?: string }>;
  price: { amount: string; currency: string };
}

const COUNTRIES = ["US", "CA", "GB", "AU", "IN"] as const;
const US_REGISTRATION = "https://console.twilio.com/us1/develop/sms/regulatory-compliance/toll-free-verification";
const selectCls = "rounded-lg border border-hairline/50 bg-inset px-2 py-2 text-[13px] text-ink focus:border-accent focus:outline-none disabled:opacity-50";
const secondaryCls = "inline-flex items-center gap-1.5 rounded-lg bg-control px-3 py-2 text-[12px] font-medium text-ink hover:bg-raised-hover disabled:opacity-50";
const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : t("whatsapp.failed"));

/** Buying spends the person's money: the button names the price, and a second click confirms it. */
export function MausBotNumberSection<S>({ number, onStatus }: { number?: OwnNumber; onStatus: (status: S) => void }) {
  const [country, setCountry] = useState<(typeof COUNTRIES)[number]>("US");
  const [kind, setKind] = useState<"local" | "toll-free">("toll-free");
  const [found, setFound] = useState<Found | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"buy" | "release" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const search = () => go(async () => {
    setFound(null);
    setChosen(null);
    setConfirming(null);
    const next: Found = await api(`/api/whatsapp/numbers?country=${country}&kind=${kind}`);
    setFound(next);
    setChosen(next.numbers[0]?.phoneNumber ?? null);
  });
  const buy = () => go(async () => {
    onStatus(await api("/api/whatsapp/number", {
      method: "POST",
      body: JSON.stringify({ phoneNumber: chosen, country, kind, confirmedAmount: found!.price.amount, confirm: true }),
    }));
    setFound(null);
    setConfirming(null);
  });
  const release = () => go(async () => {
    onStatus(await api("/api/whatsapp/number/release", { method: "POST", body: JSON.stringify({ confirm: true }) }));
    setConfirming(null);
  });

  if (number) {
    return (
      <section className="space-y-2 rounded-lg border border-hairline/50 p-3" data-own-number>
        <p className="flex items-center gap-2 text-[13px] font-medium text-ink"><Phone size={14} />{t("whatsapp.number.own", { number: number.phoneNumber })}</p>
        <p className="text-[11.5px] leading-relaxed text-ink-secondary">
          {t("whatsapp.number.ownHint")}{number.price ? ` ${t("whatsapp.number.costs", { amount: number.price.amount, currency: number.price.currency })}` : ""}
        </p>
        {number.country === "US" && <UsNote />}
        {confirming === "release"
          ? <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void release()} className="rounded-lg bg-danger px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50">{t("whatsapp.number.releaseConfirm")}</button>
            <button type="button" disabled={busy} onClick={() => setConfirming(null)} className={secondaryCls}>{t("whatsapp.number.cancel")}</button>
          </div>
          : <button type="button" disabled={busy} onClick={() => setConfirming("release")} className={secondaryCls}>{t("whatsapp.number.release")}</button>}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </section>
    );
  }

  return (
    <section className="space-y-2.5 rounded-lg border border-hairline/50 p-3" data-own-number>
      <p className="text-[13px] font-medium text-ink">{t("whatsapp.number.title")}</p>
      <p className="text-[11.5px] leading-relaxed text-ink-secondary">{t("whatsapp.number.hint")}</p>
      <div className="flex flex-wrap gap-2">
        <select aria-label={t("whatsapp.number.country")} value={country} disabled={busy} onChange={(event) => { setCountry(event.target.value as typeof country); setFound(null); }} className={selectCls}>
          {COUNTRIES.map((code) => <option key={code} value={code}>{code}</option>)}
        </select>
        <select aria-label={t("whatsapp.number.kind")} value={kind} disabled={busy} onChange={(event) => { setKind(event.target.value as typeof kind); setFound(null); }} className={selectCls}>
          <option value="toll-free">{t("whatsapp.number.tollFree")}</option>
          <option value="local">{t("whatsapp.number.local")}</option>
        </select>
        <button type="button" disabled={busy} onClick={() => void search()} className={secondaryCls}>
          {busy && !found ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}{t("whatsapp.number.find")}
        </button>
      </div>
      {found && (found.numbers.length === 0
        ? <p className="text-[12px] text-ink-secondary">{t("whatsapp.number.none")}</p>
        : <>
          <fieldset className="space-y-1">
            <legend className="sr-only">{t("whatsapp.number.pick")}</legend>
            {found.numbers.slice(0, 5).map((option) => (
              <label key={option.phoneNumber} className="flex items-center gap-2 text-[12.5px] text-ink">
                <input type="radio" name="own-number" checked={chosen === option.phoneNumber} onChange={() => { setChosen(option.phoneNumber); setConfirming(null); }} />
                {option.friendlyName}{option.locality ? ` · ${option.locality}${option.region ? `, ${option.region}` : ""}` : ""}
              </label>
            ))}
          </fieldset>
          {country === "US" && <UsNote />}
          {confirming === "buy"
            ? <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy || !chosen} onClick={() => void buy()} className="ui-button ui-button-primary">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
                {t("whatsapp.number.buyConfirm", { number: chosen ?? "", amount: found.price.amount, currency: found.price.currency })}
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(null)} className={secondaryCls}>{t("whatsapp.number.cancel")}</button>
            </div>
            : <button type="button" disabled={busy || !chosen} onClick={() => setConfirming("buy")} className="ui-button ui-button-primary">
              {t("whatsapp.number.buy", { amount: found.price.amount, currency: found.price.currency })}
            </button>}
        </>)}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </section>
  );
}

function UsNote() {
  return (
    <p className="text-[11.5px] leading-relaxed text-ink-secondary">
      {t("whatsapp.number.usNote")}{" "}
      <a href={US_REGISTRATION} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">{t("whatsapp.number.usRegister")}<ExternalLink size={11} /></a>
    </p>
  );
}
