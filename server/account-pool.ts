import type { ModelSelection } from "../shared/wire.ts";

export interface AccountPoolSettings {
  enabled: boolean;
  failover: boolean;
  restore: boolean;
  priorities: Record<string, number>;
}

export interface PoolAccount {
  instanceId: string;
  driverKind: string;
  enabled: boolean;
  defaultModel: string;
}

export function accountPoolBackups(pool: AccountPoolSettings | undefined, currentId: string, accounts: readonly PoolAccount[]): ModelSelection[] {
  if (!pool?.enabled || !pool.failover) return [];
  return accounts
    .filter((account) => account.instanceId !== currentId && account.driverKind === "antigravityAgent" && account.enabled && account.defaultModel.trim())
    .sort((left, right) => (pool.priorities[right.instanceId] ?? 100) - (pool.priorities[left.instanceId] ?? 100) || left.instanceId.localeCompare(right.instanceId))
    .map((account) => ({ instanceId: account.instanceId, model: account.defaultModel }));
}

export function accountPoolEnabled(pool: AccountPoolSettings | undefined, driverKind: string): boolean {
  return pool?.enabled === true && pool.failover && driverKind === "antigravityAgent";
}
