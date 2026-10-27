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

const PAID_API_DRIVERS: ReadonlySet<string> = new Set([
  "openai",
  "claudeApi",
  "xaiApi",
  "mistral",
]);

/** Returns true if the instance or model belongs to a free tier (OpenRouter :free models, NVIDIA free tier,
 * Hugging Face serverless free tier, Cerebras/Groq free tier, or local engines). */
export function isFreeTierInstance(instance: SelectableInstance, modelId?: string): boolean {
  const id = instance.instanceId.toLowerCase();
  const driver = instance.driverKind.toLowerCase();
  const rawModel = typeof modelId === "string" ? modelId : typeof instance.models?.default === "string" ? instance.models.default : "";
  const activeModel = rawModel.toLowerCase();

  // Explicit free naming in OpenMaus (e.g. hel1-openrouter-free, hel1-nvidia-free, huggingface-free)
  if (id.includes("free") || id.includes("local")) return true;

  // OpenRouter explicit free model suffix (e.g. "nvidia/nemotron-3.5-lightning:free")
  if (activeModel.endsWith(":free") || activeModel.includes("/free") || activeModel.includes("free-")) return true;

  // Providers with dedicated developer free tiers
  if (driver === "cerebras" || driver === "groq") return true;
  if (id.includes("nvidia") || id.includes("huggingface") || id.includes("hf-")) return true;

  return false;
}

/** Returns true if the instance uses an OAuth subscription (Claude Code CLI, ChatGPT/Codex PKCE, Cursor, Antigravity)
 * or is an explicitly free model/tier. Returns false for paid metered API key providers. */
export function isSubscriptionOrFreeInstance(instance: SelectableInstance, modelId?: string): boolean {
  // Explicit free tier models/instances are always allowed
  if (isFreeTierInstance(instance, modelId)) return true;

  if (instance.snapshot.account?.method === "api-key") return false;
  if (instance.snapshot.billing === "metered") return false;
  if (instance.access === "custom" || instance.access === "api") return false;
  if (instance.snapshot.billing === "subscription" || instance.snapshot.chatgptPlan) return true;
  if (instance.snapshot.account?.method === "login") return true;
  if (PAID_API_DRIVERS.has(instance.driverKind)) return false;
  return ["claudeAgent", "codex", "cursorAgent", "antigravity", "hermesAgent", "qwenAgent", "piAgent"].includes(instance.driverKind);
}
/** Purges paid per-token models from the options list so only free models can be seen or selected. */
export function filterSubscriptionOrFreeCatalog<T extends SelectableInstance>(instance: T): T {
  // If the instance is an OAuth subscription provider (Claude, Codex, Cursor), all its models are included in the subscription
  if (instance.snapshot.billing === "subscription" || instance.snapshot.chatgptPlan || ["claudeAgent", "codex", "cursorAgent"].includes(instance.driverKind)) {
    return instance;
  }
  // Otherwise, filter options strictly to verified free models
  const freeOptions = instance.models.options.filter((opt) => isFreeTierInstance(instance, opt.id));
  const defaultIsFree = isFreeTierInstance(instance, instance.models.default);
  return {
    ...instance,
    models: {
      ...instance.models,
      default: defaultIsFree ? instance.models.default : (freeOptions[0]?.id ?? ""),
      options: freeOptions,
    },
  };
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
    const sanitized = subscriptionOrFreeOnly && instance ? filterSubscriptionOrFreeCatalog(instance) : instance;
    if (
      (subscriptionOrFreeOnly && (!instance || !isSubscriptionOrFreeInstance(instance, preferred.model))) ||
      instance?.snapshot.state !== "available" ||
      instance.enabled === false ||
      signedOut(instance) ||
      !preferred.model.trim() ||
      // A disallowed saved engine is unusable like an unavailable one: setup, never another provider.
      context.refusal?.(instance) !== undefined ||
      (preferred.variant !== undefined && !instance.capabilities?.modelVariants) ||
      !(sanitized?.models.default === preferred.model || sanitized?.models.options.some((model) => model.id === preferred.model))
    ) {
      return { instanceId: "", model: "" };
    }
    const selection = { ...preferred };
    // A saved effort can outlive driver support: keep the model, let the provider use its default effort.
    if (selection.effort && !instance.capabilities?.effortLevels?.includes(selection.effort)) delete selection.effort;
    return selection;
  }
  const filtered = subscriptionOrFreeOnly
    ? instances
        .filter((inst) => isSubscriptionOrFreeInstance(inst))
        .map((inst) => filterSubscriptionOrFreeCatalog(inst))
    : instances;
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
