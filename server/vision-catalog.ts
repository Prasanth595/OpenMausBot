// Vision (the unified engine) reports every other engine's collected models
// in its own catalog: the picker under Vision is the one place to browse the
// whole fleet, and a picked id rides through to the freellmapi gateway like
// any other Vision model. This is a presentation-layer union over the rows a
// fleet description already contains — the driver's own catalog (seeds plus
// live /models probe) stays authoritative for default selection and the RLM
// harness — and every merged row is forced `custom` so Vision's custom-only
// picker renders it. The `provider` badge names the collecting engine, which
// is also what makes same-id duplicates across engines distinguishable.
import type { ModelCatalog } from "./contracts.ts";

export interface FleetCatalogRow {
  driverKind: string;
  displayName?: string;
  models: ModelCatalog;
}

export function mergeEnginesIntoVision<T extends FleetCatalogRow>(rows: readonly T[]): T[] {
  if (!rows.some((row) => row.driverKind === "vision")) return [...rows];
  const sources = rows.filter((row) => row.models.options.length > 0);
  return rows.map((row) => {
    if (row.driverKind !== "vision") return row;
    const seen = new Set(row.models.options.map((option) => option.id));
    const merged: ModelCatalog["options"] = [...row.models.options];
    for (const source of sources) {
      if (source === row) continue;
      const engine = source.displayName ?? source.driverKind;
      for (const option of source.models.options) {
        if (seen.has(option.id)) continue;
        seen.add(option.id);
        merged.push({
          id: option.id,
          label: option.label,
          // Vision advertises `access: "custom"`; the picker renders only
          // custom-flagged options for such engines.
          custom: true,
          provider: engine,
          ...(option.loaded ? { loaded: true } : {}),
          ...(option.contextWindow ? { contextWindow: option.contextWindow } : {}),
        });
      }
    }
    if (merged.length === row.models.options.length) return row;
    return { ...row, models: { ...row.models, options: merged } } as T;
  });
}
