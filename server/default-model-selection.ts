import type { EffortLevel, EngineAccess, InstanceConfigMap, ModelCatalog, ModelSelection, ProviderSnapshot } from "./contracts.ts";

export interface SelectableInstance {
  instanceId: string;
  driverKind: string;
  snapshot: ProviderSnapshot;
  models: ModelCatalog;
  capabilities?: { effortLevels?: readonly EffortLevel[]; modelVariants?: boolean };
  access?: EngineAccess;
  enabled?: boolean;
}

export interface DefaultSelectionContext {
  company?: (instanceId: string) => boolean;
  refusal?: (instance: SelectableInstance) => string | undefined;
  subscriptionOrFreeOnly?: boolean;
}

const claudeFirst = (instances: readonly SelectableInstance[]) =>
  instances.find((instance) => instance.driverKind === "claudeAgent") ?? instances[0];

/** The saved config's enabled switch and picker group win over what the driver reports. */
export function withInstanceConfig<T extends SelectableInstance>(instances: readonly T[], configs: InstanceConfigMap): T[] {
  return instances.map((instance) => ({
    ...instance,
    enabled: configs[instance.instanceId]?.enabled ?? instance.enabled,
    ...(configs[instance.instanceId]?.access ? { access: configs[instance.instanceId].access } : {}),
  }));
}

const API_KEY_DRIVERS: ReadonlySet<string> = new Set([
  "openai-compat",
  "openai",
  "claudeApi",
  "xaiApi",
  "mistral",
  "cerebras",
  "groq",
  "openrouter",
]);

/** Returns true if the instance uses an OAuth subscription (Claude Code CLI, ChatGPT/Codex PKCE, Cursor, Antigravity)
 * or is a local/free engine. Returns false for paid metered API key providers. */
export function isSubscriptionOrFreeInstance(instance: SelectableInstance): boolean {
  if (instance.snapshot.account?.method === "api-key") return false;
  if (instance.snapshot.billing === "metered") return false;
  if (instance.access === "custom" || instance.access === "api") return false;
  if (API_KEY_DRIVERS.has(instance.driverKind)) return false;
  if (instance.snapshot.billing === "subscription" || instance.snapshot.chatgptPlan) return true;
  if (instance.snapshot.account?.method === "login") return true;
  return ["claudeAgent", "codex", "cursorAgent", "antigravity", "hermesAgent", "qwenAgent", "piAgent"].includes(instance.driverKind);
}

/** A custom endpoint brings its own credential, so its sign-in state does not count. */
export function signedOut(instance: SelectableInstance): boolean {
  return instance.snapshot.state === "available" && instance.access !== "custom" && instance.snapshot.authenticated === false;
}

export function readyToRun(instance: SelectableInstance, context: DefaultSelectionContext = {}): boolean {
  const subscriptionOrFreeOnly = context.subscriptionOrFreeOnly ?? process.env.OMB_SUBSCRIPTION_OR_FREE_ONLY === "1";
  if (subscriptionOrFreeOnly && !isSubscriptionOrFreeInstance(instance)) return false;
  return instance.enabled !== false && instance.snapshot.state === "available" && context.refusal?.(instance) === undefined && !signedOut(instance);
}
const defaultModel = (instance: SelectableInstance) => instance.models.default.trim()
  ? instance.models.default
  : instance.models.options.find((model) => model.id.trim())?.id ?? "";

/** A saved choice is intentional: an unavailable provider sends new bots to setup, never silently to another provider. On
 * an enrolled desktop a working personal engine beats a Company one, so billing stays the person's choice. */
export function selectDefaultModelSelection(
  instances: readonly SelectableInstance[],
  preferred?: ModelSelection,
  context: DefaultSelectionContext = {},
): ModelSelection {
  const subscriptionOrFreeOnly = context.subscriptionOrFreeOnly ?? process.env.OMB_SUBSCRIPTION_OR_FREE_ONLY === "1";
  if (preferred && (preferred.instanceId || preferred.model)) {
    const instance = instances.find((candidate) => candidate.instanceId === preferred.instanceId);
    if (
      (subscriptionOrFreeOnly && (!instance || !isSubscriptionOrFreeInstance(instance))) ||
      instance?.snapshot.state !== "available" ||
      instance.enabled === false ||
      signedOut(instance) ||
      !preferred.model.trim() ||
      // A disallowed saved engine is unusable like an unavailable one: setup, never another provider.
      context.refusal?.(instance) !== undefined ||
      (preferred.variant !== undefined && !instance.capabilities?.modelVariants) ||
      !(instance.models.default === preferred.model || instance.models.options.some((model) => model.id === preferred.model))
    ) {
      return { instanceId: "", model: "" };
    }
    const selection = { ...preferred };
    // A saved effort can outlive driver support: keep the model, let the provider use its default effort.
    if (selection.effort && !instance.capabilities?.effortLevels?.includes(selection.effort)) delete selection.effort;
    return selection;
  }
  const filtered = subscriptionOrFreeOnly ? instances.filter(isSubscriptionOrFreeInstance) : instances;
  const available = filtered.filter((instance) => instance.enabled !== false && instance.snapshot.state === "available" && context.refusal?.(instance) === undefined && defaultModel(instance));
  const ready = available.filter((instance) => readyToRun(instance, context));
  const company = context.company;
  const personal = company && filtered.some((instance) => company(instance.instanceId))
    ? claudeFirst(ready.filter((instance) => !company(instance.instanceId)))
    : undefined;
  const pick = personal ?? claudeFirst(ready) ?? claudeFirst(available);
  return { instanceId: pick?.instanceId ?? "", model: pick ? defaultModel(pick) : "" };
}

/** An explicit effort or variant wins; an engine without the level sends none rather than failing turn 1. */
export function withNewBotEffort(
  selection: ModelSelection,
  effort: EffortLevel | undefined,
  offered: readonly EffortLevel[] | undefined,
): ModelSelection {
  if (!effort || selection.effort !== undefined || selection.variant !== undefined || !offered?.includes(effort)) {
    return selection;
  }
  return { ...selection, effort };
}
