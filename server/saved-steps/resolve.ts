import { elementPath, type WireElement } from "./driver-wire.ts";
import type { AppIdentity, ElementIdentity, RecipeStep } from "./rules.ts";

/** `gate`: the computer's control gate refused the call (a person holds it, another turn has it): the step was not tried. */
export type CallOutcome = { ok: true; structured: Record<string, unknown> } | { ok: false; error: string; gate?: true };
export interface ComputerCaller { call(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallOutcome> }
export type Match<T> = { ok: true; value: T } | { ok: false; reason: "none" | "ambiguous" };
type Resolved = { ok: true; args: Record<string, unknown> } | Extract<CallOutcome, { ok: false }>;

type Kind = "string" | "number" | "boolean";
interface Shape { required: Record<string, Kind>; optional: Record<string, Kind>; id?: string }
interface LiveApp { pid: number; name: string; bundle_id?: string; running?: boolean }
interface LiveWindow { window_id: number; pid: number; title: string }

const APP: Shape = { required: { pid: "number", name: "string" }, optional: { bundle_id: "string", running: "boolean" } };
const WINDOW: Shape = { required: { window_id: "number", pid: "number", title: "string" }, optional: {}, id: "window_id" };
const ELEMENT: Shape = {
  required: { element_index: "number", role: "string", depth: "number" },
  optional: { element_token: "string", label: "string", parent_index: "number" },
  id: "element_index",
};

const NONE = { ok: false, reason: "none" } as const;
const AMBIGUOUS = { ok: false, reason: "ambiguous" } as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function readEntry(item: unknown, shape: Shape): Record<string, unknown> | null {
  if (!isRecord(item)) return null;
  const entry: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(shape.required)) {
    if (typeof item[key] !== kind) return null;
    entry[key] = item[key];
  }
  for (const [key, kind] of Object.entries(shape.optional)) {
    const value = item[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== kind) return null;
    entry[key] = value;
  }
  return entry;
}

// Safety invariant: one unreadable entry or one repeated id makes the whole list unreadable.
// Skipping either could hide the second match that makes a target ambiguous.
function readList<T>(value: unknown, shape: Shape): T[] | null {
  if (!Array.isArray(value)) return null;
  const entries: T[] = [];
  const ids = new Set<unknown>();
  for (const item of value) {
    const entry = readEntry(item, shape);
    if (entry === null) return null;
    if (shape.id !== undefined) {
      if (ids.has(entry[shape.id])) return null;
      ids.add(entry[shape.id]);
    }
    entries.push(entry as T);
  }
  return entries;
}

function only<T>(candidates: readonly T[]): Match<T> {
  const [first, ...rest] = candidates;
  if (first === undefined) return NONE;
  return rest.length ? AMBIGUOUS : { ok: true, value: first };
}

export function matchApp(apps: unknown, app: AppIdentity): Match<number> {
  const list = readList<LiveApp>(apps, APP);
  const sameApp = app.bundleId ? (live: LiveApp) => live.bundle_id === app.bundleId : app.name ? (live: LiveApp) => live.name === app.name : null;
  if (!list || !sameApp) return NONE;
  return only(list.filter((live) => live.pid > 0 && live.running !== false && sameApp(live)).map((live) => live.pid));
}

export function matchWindow(windows: unknown, pid: number, window: { title: string }): Match<number> {
  const list = readList<LiveWindow>(windows, WINDOW);
  if (!list) return NONE;
  return only(list.filter((live) => live.pid === pid && live.title === window.title).map((live) => live.window_id));
}

const samePath = (path: readonly string[], saved: readonly string[]) => path.length === saved.length && path.every((part, index) => part === saved[index]);

export function matchElement(elements: unknown, element: ElementIdentity): Match<WireElement> {
  const list = readList<WireElement>(elements, ELEMENT);
  if (!list) return NONE;
  const candidates = list
    .filter((live) => live.role === element.role && live.label === element.label)
    .map((live) => ({ live, path: elementPath(list, live) }))
    .filter(({ path }) => path === null || samePath(path, element.path));
  const match = only(candidates);
  if (!match.ok) return match;
  return match.value.path === null ? NONE : { ok: true, value: match.value.live };
}

const COUNTS = ["element_count", "total_element_count", "returned_element_count", "filtered_element_count"] as const;
const hasText = (value: unknown) => typeof value === "string" && value.trim() !== "";
const countFits = (count: unknown, returned: number) => count === undefined || count === null || (typeof count === "number" && count <= returned);

function wholeTree(state: Record<string, unknown>): boolean {
  const returned = Array.isArray(state.elements) ? state.elements.length : 0;
  return state.elements_complete === true && state.truncated !== true && !hasText(state.truncation_reason)
    && COUNTS.every((key) => countFits(state[key], returned));
}

const treeDegraded = (state: Record<string, unknown>) => state.degraded === true || hasText(state.degraded_reason);

const appName = (app: AppIdentity) => app.name || app.bundleId || "the app";
const fail = (error: string): Resolved => ({ ok: false, error });

export async function resolveStep(step: RecipeStep, caller: ComputerCaller, signal: AbortSignal): Promise<Resolved> {
  const { app, window, element } = step;
  if (step.tool === "launch_app") return { ok: true, args: step.args };
  if (!app) return fail("the saved step does not name its app");
  if (element && !window) return fail("the saved step does not name its window");
  const name = appName(app);

  const apps = await caller.call("list_apps", {}, signal);
  if (!apps.ok) return apps;
  const pid = matchApp(apps.structured.apps, app);
  if (!pid.ok) return fail(pid.reason === "none" ? `${name} is not running` : `more than one ${name} app is running`);
  const args: Record<string, unknown> = { ...step.args, pid: pid.value };
  if (!window) return { ok: true, args };

  const windows = await caller.call("list_windows", { pid: pid.value, on_screen_only: false }, signal);
  if (!windows.ok) return windows;
  const windowId = matchWindow(windows.structured.windows, pid.value, window);
  if (!windowId.ok) return fail(`${windowId.reason === "none" ? "no window" : "more than one window"} titled "${window.title}"`);
  args.window_id = windowId.value;
  if (!element) return { ok: true, args };

  const state = await caller.call("get_window_state", { pid: pid.value, window_id: windowId.value, include_screenshot: false }, signal);
  if (!state.ok) return state;
  const tree = state.structured;
  if (tree.pid !== pid.value || tree.window_id !== windowId.value) return fail("the computer answered for a different window");
  if (treeDegraded(tree)) return fail(`${window.title} could not be read reliably`);
  if (!wholeTree(tree)) return fail(`only part of ${window.title} could be read`);
  const found = matchElement(tree.elements, element);
  if (!found.ok) {
    const target = `"${element.label}" (${element.role}) in ${window.title}`;
    return fail(found.reason === "none" ? `no ${target}` : `more than one ${target}`);
  }
  const { element_token: token, element_index: index } = found.value;
  return { ok: true, args: token === undefined ? { ...args, element_index: index } : { ...args, element_token: token } };
}
