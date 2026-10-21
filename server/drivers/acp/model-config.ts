import type { ModelVariantOption } from "../../contracts.ts";

export function acpVariantOption(result: any): { configId: string; options: ModelVariantOption[]; currentValue?: string } | undefined {
  const option = (Array.isArray(result?.configOptions) ? result.configOptions : []).find(
    (entry: any) => entry?.type === "select" && typeof entry.id === "string"
      && (entry.id === "effort" || entry.category === "thought_level"),
  );
  if (!option) return;
  const options: ModelVariantOption[] = [];
  const seen = new Set<string>();
  const collect = (entries: unknown) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (typeof entry?.value === "string" && !seen.has(entry.value)) {
        seen.add(entry.value);
        options.push({ id: entry.value, label: typeof entry.name === "string" ? entry.name : entry.value });
      } else if (Array.isArray(entry?.options)) collect(entry.options);
    }
  };
  collect(option.options);
  return {
    configId: option.id,
    options,
    ...(typeof option.currentValue === "string" ? { currentValue: option.currentValue } : {}),
  };
}

export function offeredModels(result: any, configId: string): string[] {
  const option = (Array.isArray(result?.configOptions) ? result.configOptions : []).find(
    (entry: any) => entry?.id === configId,
  );
  const ids: string[] = [];
  const visit = (entries: unknown) => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (typeof entry?.value === "string") ids.push(entry.value);
      else if (Array.isArray(entry?.options)) visit(entry.options);
    }
  };
  visit(option?.options);
  return ids;
}

export async function selectExactReviewModel(input: {
  request: (method: string, params: unknown) => Promise<any>;
  sessionId: string;
  session: any;
  displayName: string;
  modelConfigId?: string;
  model: string;
  variant?: string;
}): Promise<void> {
  const { request, sessionId, session, displayName, modelConfigId, model, variant } = input;
  const configId = modelConfigId;
  if (!configId) throw new Error(`${displayName} cannot select an exact review model`);
  let current = session;
  const selected = (result: any) => (Array.isArray(result?.configOptions) ? result.configOptions : [])
    .find((entry: any) => entry?.id === configId)?.currentValue;
  if (!offeredModels(current, configId).includes(model)) throw new Error(`${displayName} does not offer the review model`);
  if (selected(current) !== model) {
    current = await request("session/set_config_option", { sessionId, configId, value: model });
  }
  if (selected(current) !== model) throw new Error(`${displayName} did not select the review model`);
  if (variant !== undefined) {
    const option = acpVariantOption(current);
    if (!option?.options.some((entry) => entry.id === variant)) throw new Error(`${displayName} does not offer the review variant`);
    if (option.currentValue !== variant) {
      current = await request("session/set_config_option", { sessionId, configId: option.configId, value: variant });
    }
    if (acpVariantOption(current)?.currentValue !== variant) throw new Error(`${displayName} did not select the review variant`);
  }
}
