export interface WireElement {
  element_index: number;
  element_token?: string;
  role: string;
  label?: string;
  parent_index?: number;
  depth: number;
}
export interface WireApp { pid: number; name: string; bundle_id?: string; running?: boolean }
export interface WireWindow { window_id: number; pid?: number; title: string; app_name?: string }
export interface SlimStructured {
  elements?: WireElement[];
  apps?: WireApp[];
  windows?: WireWindow[];
  pid?: number;
  window_id?: number;
  bundle_id?: string;
  name?: string;
  app_name?: string;
  window_title?: string;
  refusal?: { code?: string; message?: string };
}
export interface SlimResult { isError: boolean; rpcError?: true; structured?: SlimStructured }
export interface JournalEntry { tool: string; arguments: Record<string, unknown>; result: SlimResult }

export const MAX_ELEMENTS = 1500;

const ROOT_ROLES = new Set(["AXWindow", "AXApplication"]);

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);

function pick(source: Rec, keys: readonly string[], types: Record<string, "string" | "number" | "boolean">): Rec {
  const out: Rec = {};
  for (const key of keys) if (typeof source[key] === types[key]) out[key] = source[key];
  return out;
}

const ELEMENT_TYPES = { element_index: "number", element_token: "string", role: "string", label: "string", parent_index: "number", depth: "number" } as const;
const APP_TYPES = { pid: "number", name: "string", bundle_id: "string", running: "boolean" } as const;
const WINDOW_TYPES = { window_id: "number", pid: "number", title: "string", app_name: "string" } as const;
const TOP_TYPES = { pid: "number", window_id: "number", bundle_id: "string", name: "string", app_name: "string", window_title: "string" } as const;

function slimList<T>(value: unknown, types: Record<string, "string" | "number" | "boolean">, required: readonly string[], max = Infinity): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: Rec[] = [];
  for (const item of value) {
    if (items.length >= max) break;
    if (!isRec(item)) continue;
    const slim = pick(item, Object.keys(types), types);
    if (required.every((key) => key in slim)) items.push(slim);
  }
  return items as T[];
}

function slimStructured(raw: Rec): SlimStructured {
  const out: SlimStructured = pick(raw, Object.keys(TOP_TYPES), TOP_TYPES);
  const elements = slimList<WireElement>(raw.elements, ELEMENT_TYPES, ["element_index", "role", "depth"], MAX_ELEMENTS);
  const apps = slimList<WireApp>(raw.apps, APP_TYPES, ["pid", "name"]);
  const windows = slimList<WireWindow>(raw.windows, WINDOW_TYPES, ["window_id", "title"]);
  if (elements) out.elements = elements;
  if (apps) out.apps = apps;
  if (windows) out.windows = windows;
  if (isRec(raw.refusal)) {
    const refusal = pick(raw.refusal, ["code", "message"], { code: "string", message: "string" });
    out.refusal = refusal;
  }
  return out;
}

export function slimResponse(frame: unknown): SlimResult {
  if (!isRec(frame)) return { isError: true, rpcError: true };
  if (frame.error !== undefined) return { isError: true, rpcError: true };
  const result = isRec(frame.result) ? frame.result : {};
  const slim: SlimResult = { isError: result.isError === true };
  if (isRec(result.structuredContent)) slim.structured = slimStructured(result.structuredContent);
  return slim;
}

export function elementPath(elements: readonly WireElement[], element: WireElement): string[] | null {
  const byIndex = new Map(elements.map((candidate) => [candidate.element_index, candidate]));
  const chain: string[] = [];
  const seen = new Set<number>([element.element_index]);
  let node = element;
  while (node.parent_index !== undefined) {
    const parent = byIndex.get(node.parent_index);
    if (!parent || seen.has(parent.element_index)) return null;
    seen.add(parent.element_index);
    if (!ROOT_ROLES.has(parent.role)) chain.push(`${parent.role}:${parent.label ?? ""}`);
    node = parent;
  }
  return node.depth > 0 ? null : chain.reverse();
}
