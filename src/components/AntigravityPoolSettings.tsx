import { useEffect, useState } from "react";

import { api, useStore, type InstanceInfo } from "@/state/store";
import { Switch } from "./SettingsPrimitives";

type Quota = { groups: Array<{ name: string; buckets: Array<{ name: string; remainingPercent: number; resetsAt: string | null }> }> };

const defaults = { enabled: false, failover: true, restore: true, priorities: {} as Record<string, number> };

export function AntigravityPoolSettings({ accounts }: { accounts: InstanceInfo[] }) {
  const { state, dispatch } = useStore();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [quotas, setQuotas] = useState<Record<string, Quota>>({});
  useEffect(() => { void Promise.all(accounts.map(async (account) => [account.instanceId, await api<Quota>(`/api/antigravity-quota?instance=${encodeURIComponent(account.instanceId)}`).catch(() => ({ groups: [] }))] as const)).then((rows) => setQuotas(Object.fromEntries(rows))); }, [accounts]);
  const pool = state.config?.accountPools?.antigravity ?? defaults;
  const save = async (next: typeof defaults) => {
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
  const update = (patch: Partial<typeof defaults>) => void save({ ...pool, ...patch });
  return (
    <div className="rounded-xl border border-hairline/50 bg-card p-4">
      <div className="text-[15px] font-medium text-ink">Automatic account pool</div>
      <p className="mt-0.5 text-[13px] leading-relaxed text-ink-secondary">Use connected Antigravity accounts in priority order when heavy work exhausts an account.</p>
      <Toggle label="Use automatic account pool" checked={pool.enabled} disabled={saving} onChange={(enabled) => update({ enabled })} />
      <Toggle label="Switch after quota is exhausted" checked={pool.failover} disabled={saving || !pool.enabled} onChange={(failover) => update({ failover })} />
      <Toggle label="Return to the preferred account after reset" checked={pool.restore} disabled={saving || !pool.enabled} onChange={(restore) => update({ restore })} />
      <div className="mt-4 space-y-2">
        <div className="text-[13px] font-medium text-ink">Account priority</div>
        {accounts.map((account) => <div key={account.instanceId} className="space-y-1"><label className="flex items-center justify-between gap-3 text-[13px] text-ink">
          <span className="min-w-0 truncate">{account.displayName}</span>
          <span className="flex shrink-0 items-center gap-1"><input type="number" min="0" max="100" value={pool.priorities[account.instanceId] ?? 100}
            disabled={saving} aria-label={`${account.displayName} priority`} onChange={(event) => {
              const value = Math.max(0, Math.min(100, Number(event.target.value) || 0));
              void save({ ...pool, priorities: { ...pool.priorities, [account.instanceId]: value } });
            }}
            className="w-16 rounded border border-hairline/50 bg-inset px-2 py-1 text-right tabular-nums" />%</span>
        </label>{(quotas[account.instanceId]?.groups ?? []).map((group) => <div key={group.name} className="pl-1 text-[11.5px] text-ink-secondary">{group.name}: {group.buckets.map((bucket) => `${bucket.name} ${bucket.remainingPercent}%`).join(" · ")}</div>)}</div>)}
      </div>
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <div className="mt-3 flex items-center justify-between gap-3"><span className="text-[13px] text-ink">{label}</span><Switch checked={checked} disabled={disabled} onClick={() => onChange(!checked)} /></div>;
}
