import { useEffect, useState } from "react";

import { api, useStore, type InstanceInfo } from "@/state/store";
import { t } from "@/lib/i18n";
import { Switch } from "./SettingsPrimitives";

type Quota = { groups: Array<{ name: string; buckets: Array<{ name: string; remainingPercent: number; resetsAt: string | null }> }> };
type Pool = { enabled: boolean; failover: boolean; restore: boolean; priorities: Record<string, number> };

const defaults: Pool = { enabled: false, failover: true, restore: true, priorities: {} };

function usePool() {
  const { state, dispatch } = useStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pool = state.config?.accountPools?.antigravity ?? defaults;
  const save = async (next: Pool) => {
    setSaving(true);
    setError("");
    try {
      const config = await api("/api/config", { method: "PUT", body: JSON.stringify({ accountPools: { antigravity: next } }) });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return { pool, save, saving, error };
}

/** Pool-wide choices stay at the top; account choices belong on each account's card. */
export function AntigravityPoolSettings() {
  const { pool, save, saving, error } = usePool();
  const update = (patch: Partial<Pool>) => void save({ ...pool, ...patch });
  return (
    <div className="rounded-xl border border-hairline/50 bg-card p-4">
      <div className="text-[15px] font-medium text-ink">{t("accountPool.title")}</div>
      <p className="mt-0.5 text-[13px] leading-relaxed text-ink-secondary">{t("accountPool.description")}</p>
      <Toggle label={t("accountPool.enabled")} checked={pool.enabled} disabled={saving} onChange={(enabled) => update({ enabled })} />
      <Toggle label={t("accountPool.failover")} checked={pool.failover} disabled={saving || !pool.enabled} onChange={(failover) => update({ failover })} />
      <Toggle label={t("accountPool.restore")} checked={pool.restore} disabled={saving || !pool.enabled} onChange={(restore) => update({ restore })} />
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

export function AntigravityAccountPoolSettings({ account }: { account: InstanceInfo }) {
  const { state, dispatch, flushBotPatches } = useStore();
  const { pool, save, saving, error } = usePool();
  const [draftPriority, setDraftPriority] = useState(String(pool.priorities[account.instanceId] ?? 100));
  const [quota, setQuota] = useState<Quota | null>(null);
  const [quotaState, setQuotaState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [switching, setSwitching] = useState(false);
  const [switchResult, setSwitchResult] = useState("");

  useEffect(() => { setDraftPriority(String(pool.priorities[account.instanceId] ?? 100)); }, [account.instanceId, pool.priorities]);
  useEffect(() => {
    let cancelled = false;
    setQuotaState("loading");
    void api<Quota>(`/api/antigravity-quota?instance=${encodeURIComponent(account.instanceId)}`)
      .then((value) => { if (!cancelled) { setQuota(value); setQuotaState("ready"); } })
      .catch(() => { if (!cancelled) { setQuota(null); setQuotaState("unavailable"); } });
    return () => { cancelled = true; };
  }, [account.instanceId]);

  const commitPriority = () => {
    const value = Math.max(0, Math.min(100, Number.parseInt(draftPriority, 10) || 0));
    setDraftPriority(String(value));
    if (value !== (pool.priorities[account.instanceId] ?? 100)) {
      void save({ ...pool, priorities: { ...pool.priorities, [account.instanceId]: value } });
    }
  };

  const switchAllBots = async () => {
    const bots = state.bots.filter((bot) => bot.modelSelection.instanceId !== account.instanceId);
    if (!bots.length || switching) return;
    setSwitching(true);
    setSwitchResult("");
    const supported = new Set(account.models.options.map((model) => model.id));
    for (const bot of bots) {
      const model = supported.has(bot.modelSelection.model) ? bot.modelSelection.model : account.models.default;
      dispatch({ type: "setModel", botId: bot.id, selection: { ...bot.modelSelection, instanceId: account.instanceId, model } });
    }
    const settled = await Promise.all(bots.map((bot) => flushBotPatches(bot.id).catch(() => null)));
    const moved = settled.filter((bot) => bot?.modelSelection.instanceId === account.instanceId).length;
    setSwitchResult(moved === bots.length ? t("accountPool.switchDone", { count: moved }) : t("accountPool.switchPartial", { moved, count: bots.length }));
    setSwitching(false);
  };

  const otherBots = state.bots.filter((bot) => bot.modelSelection.instanceId !== account.instanceId);
  return <section data-antigravity-account-pool={account.instanceId} className="mt-3 space-y-4 rounded-xl border border-hairline/40 bg-inset/30 p-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <span>{t("accountPool.priority")}</span>
        <span className="flex items-center gap-1">
          <input type="text" inputMode="numeric" pattern="[0-9]*" value={draftPriority} disabled={saving}
            aria-label={t("accountPool.priorityLabel", { name: account.displayName })}
            onChange={(event) => setDraftPriority(event.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
            onBlur={commitPriority} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            className="w-14 rounded border border-hairline/50 bg-card px-2 py-1 text-right tabular-nums" />%
        </span>
      </label>
      <span className="text-[11px] text-ink-secondary">{t("accountPool.priorityHint")}</span>
    </div>
    <QuotaBars quota={quota} state={quotaState} />
    <div className="border-t border-hairline/40 pt-3">
      <p className="text-[13px] font-medium text-ink">{t("accountPool.switchTitle")}</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("accountPool.switchDescription")}</p>
      <button type="button" className="ui-button mt-2" disabled={switching || otherBots.length === 0} onClick={() => void switchAllBots()}>
        {switching ? t("accountPool.switching") : t("accountPool.switchAll", { name: account.displayName })}
      </button>
      {switchResult && <p role="status" className="mt-2 text-[12px] text-ink-secondary">{switchResult}</p>}
    </div>
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
  </section>;
}

function QuotaBars({ quota, state }: { quota: Quota | null; state: "loading" | "ready" | "unavailable" }) {
  if (state === "loading") return <p className="text-[12px] text-ink-secondary">{t("accountPool.quotaLoading")}</p>;
  if (state === "unavailable" || !quota?.groups.length) return <p className="text-[12px] text-ink-secondary">{t("accountPool.quotaUnavailable")}</p>;
  return <div className="space-y-3" aria-label={t("accountPool.quotaLabel")}>
    {quota.groups.map((group) => <div key={group.name} className="space-y-2">
      <p className="text-[12px] font-medium text-ink">{group.name}</p>
      {group.buckets.map((bucket) => <div key={`${group.name}-${bucket.name}`}>
        <div className="mb-1 flex items-baseline justify-between gap-3 text-[11px] text-ink-secondary"><span className="min-w-0 truncate">{bucket.name}</span><span className="shrink-0 tabular-nums">{bucket.remainingPercent}%</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-control" role="progressbar" aria-label={`${group.name}: ${bucket.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bucket.remainingPercent}>
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${bucket.remainingPercent}%` }} />
        </div>
        {bucket.resetsAt && <p className="mt-1 text-[10.5px] text-ink-secondary">{t("accountPool.resetsAt", { time: new Date(bucket.resetsAt).toLocaleString() })}</p>}
      </div>)}
    </div>)}
  </div>;
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <div className="mt-3 flex items-center justify-between gap-3"><span className="text-[13px] text-ink">{label}</span><Switch checked={checked} disabled={disabled} onClick={() => onChange(!checked)} /></div>;
}
