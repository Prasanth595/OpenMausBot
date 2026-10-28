import { t } from "@/lib/i18n";

export interface ConnectorStatus {
  connected: boolean;
  pending?: boolean;
  status?: string;
  accounts?: ConnectorAccount[];
}

export interface ConnectorAccount {
  id: string;
  alias?: string;
  status: string;
}

export type ConnectorInventoryPhase = "loading" | "ready" | "error";

const ACTIVE = /^active$/i;
const UNFINISHED = /^(initiated|initializing|pending)$/i;

/** An app counts as connected only through an ACTIVE account; with no account list (an app that needs no sign-in, or
 *  only the Session's answer) the server's flag stands. */
export function hasActiveConnection(state: ConnectorStatus | undefined): boolean {
  const accounts = state?.accounts ?? [];
  return accounts.length ? accounts.some((account) => ACTIVE.test(account.status)) : state?.connected === true;
}

/** One app outside the Composio inventory: Whop, HighLevel or X. */
export interface NativeAppConnection {
  slug: string;
  /** false when it is not connected, or when it could not be asked. Either way the pill stays. */
  connected: boolean;
}

/** True only when the catalogue names at least one app and every one of them has an ACTIVE, settled connection.
 *  The inventory endpoint lists only connected apps, so an app missing from `services` is unconnected, not unknown:
 *  the catalogue is the universe, the inventory only says which entries are satisfied. */
export function everyCatalogueAppConnected(
  services: Record<string, ConnectorStatus>,
  authoritative: boolean,
  catalogue: readonly string[] | null,
): boolean {
  if (!authoritative || !catalogue || catalogue.length === 0) return false;
  return catalogue.every((slug) => {
    const state = services[slug];
    return hasActiveConnection(state) && state?.pending !== true;
  });
}

/** The whole Apps universe: every catalogue app plus the native Whop, HighLevel and X cards. Native apps are required,
 *  because leaving them out would hide the pill while one of them is still unconnected. */
export function everyAppConnected(
  services: Record<string, ConnectorStatus>,
  authoritative: boolean,
  catalogue: readonly string[] | null,
  native: readonly NativeAppConnection[],
): boolean {
  return native.length > 0
    && native.every((app) => app.connected)
    && everyCatalogueAppConnected(services, authoritative, catalogue);
}

export function needsReconnect(account: ConnectorAccount): boolean {
  return !ACTIVE.test(account.status) && !UNFINISHED.test(account.status);
}

/** The newest account that stopped working, when the app has no working one left. */
export function accountToReconnect(state: ConnectorStatus | undefined): ConnectorAccount | undefined {
  return hasActiveConnection(state) ? undefined : state?.accounts?.find(needsReconnect);
}

export function requiresAccountAlias(message: string) {
  return /account alias.*existing connection.*not replaced/i.test(message);
}

export function accountAliasTaken(message: string) {
  return /account alias .* is already in use/i.test(message);
}

export function connectorActionLabel(
  phase: ConnectorInventoryPhase,
  state: { busy: boolean; included: boolean; canContinue: boolean; pending?: boolean; reconnect?: boolean; hasAccounts: boolean; failed: boolean },
) {
  if (state.busy) return null;
  if (state.included) return t("connectors.action.included");
  if (phase === "loading") return t("connectors.action.checking");
  if (phase === "error") return t("connectors.action.unavailable");
  if (state.canContinue) return t("connectors.action.continue");
  if (state.pending) return t("connectors.action.checkStatus");
  if (state.reconnect) return t("connectors.action.reconnect");
  if (state.hasAccounts) return t("connectors.action.addAccount");
  if (state.failed) return t("connectors.action.retry");
  return t("connectors.action.connect");
}

export function connectedInventoryCopy(phase: ConnectorInventoryPhase) {
  if (phase === "loading") return {
    title: t("connectors.empty.loadingTitle"),
    description: t("connectors.empty.loadingDesc"),
  };
  if (phase === "error") return {
    title: t("connectors.empty.errorTitle"),
    description: t("connectors.empty.errorDesc"),
  };
  return {
    title: t("connectors.empty.noneTitle"),
    description: t("connectors.empty.noneDesc"),
  };
}
